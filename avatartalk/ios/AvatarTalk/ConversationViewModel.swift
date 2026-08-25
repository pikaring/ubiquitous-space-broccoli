import Foundation
import Observation

struct ChatMessage: Identifiable, Equatable {
    enum Role { case you, avatar }

    let id = UUID()
    let role: Role
    var text: String
}

@MainActor
@Observable
final class ConversationViewModel {
    enum State: Equatable {
        case idle
        case listening
        case thinking
        case speaking
    }

    private(set) var state: State = .idle
    private(set) var messages: [ChatMessage] = []
    /// 認識途中の文字列（吹き出しに薄く出す）
    private(set) var partialInput = ""
    private(set) var errorMessage: String?
    private(set) var permissionGranted = false

    let avatar = AvatarController()

    private let settings = AppSettings.shared
    private let recognizer = SpeechRecognizer()
    private let speaker = Speaker()
    private var streamTask: Task<Void, Never>?

    /// まだ読み上げに回していない返事の断片
    private var pendingSpeech = ""

    init() {
        recognizer.onPartial = { [weak self] text in
            self?.partialInput = text
        }
        recognizer.onFinal = { [weak self] text in
            self?.partialInput = ""
            self?.send(text)
        }
        recognizer.onLevel = { [weak self] level in
            self?.avatar.micLevel = level
        }
        speaker.onViseme = { [weak self] viseme in
            self?.avatar.setViseme(viseme)
        }
        speaker.onStateChange = { [weak self] speaking in
            guard let self else { return }
            if speaking {
                self.setState(.speaking)
            } else if self.state == .speaking {
                self.setState(.idle)
                if self.settings.handsFree { self.startListening() }
            }
        }
    }

    // MARK: - 権限

    func prepare() async {
        permissionGranted = await recognizer.requestAuthorization()
        if !permissionGranted {
            errorMessage = "マイクと音声認識を許可すると話しかけられます。文字入力だけでも使えます。"
        }
    }

    // MARK: - 操作

    /// マイクボタン。状態に応じて「聞き始める／聞き終える／黙らせる」を切り替える。
    func tapMicrophone() {
        switch state {
        case .idle:
            startListening()
        case .listening:
            recognizer.stop()
        case .thinking:
            cancelReply()
        case .speaking:
            speaker.stop()
            setState(.idle)
        }
    }

    func startListening() {
        guard state != .listening else { return }
        speaker.stop()
        errorMessage = nil
        do {
            try recognizer.start()
            setState(.listening)
        } catch {
            errorMessage = error.localizedDescription
            setState(.idle)
        }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            setState(.idle)
            return
        }
        guard let client = BridgeClient(settings: settings) else {
            errorMessage = BridgeError.notConfigured.localizedDescription
            setState(.idle)
            return
        }

        messages.append(ChatMessage(role: .you, text: trimmed))
        messages.append(ChatMessage(role: .avatar, text: ""))
        setState(.thinking)
        pendingSpeech = ""

        streamTask?.cancel()
        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in client.chat(message: trimmed, sessionID: settings.sessionID) {
                    if Task.isCancelled { return }
                    switch event {
                    case let .session(id):
                        self.settings.sessionID = id
                    case let .delta(chunk):
                        self.appendReply(chunk)
                    case .done:
                        self.flushSpeech(force: true)
                    case let .failure(message):
                        self.errorMessage = message
                        self.setState(.idle)
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                self.errorMessage = error.localizedDescription
            }
            if self.state == .thinking {
                // 返事が空だった、あるいは読み上げが始まらなかった場合。
                self.setState(.idle)
            }
        }
    }

    func cancelReply() {
        streamTask?.cancel()
        streamTask = nil
        speaker.stop()
        pendingSpeech = ""
        setState(.idle)
    }

    func resetConversation() {
        cancelReply()
        recognizer.cancel()
        messages.removeAll()
        settings.sessionID = nil
        errorMessage = nil
        setState(.idle)
    }

    func dismissError() {
        errorMessage = nil
    }

    // MARK: - 内部

    private func setState(_ next: State) {
        state = next
        switch next {
        case .idle: avatar.mode = .idle
        case .listening: avatar.mode = .listening
        case .thinking: avatar.mode = .thinking
        case .speaking: avatar.mode = .speaking
        }
    }

    private func appendReply(_ chunk: String) {
        if let index = messages.lastIndex(where: { $0.role == .avatar }) {
            messages[index].text += chunk
        }
        pendingSpeech += chunk
        flushSpeech(force: false)
    }

    /// 文の切れ目まで届いたら、そこまでを先に読み上げてしまう。
    /// 全部そろうのを待たないぶん、返事が始まるまでが体感でかなり速くなる。
    private func flushSpeech(force: Bool) {
        let breaks: Set<Character> = ["。", "！", "？", "\n", "!", "?", "．"]

        while let index = pendingSpeech.firstIndex(where: { breaks.contains($0) }) {
            let sentence = String(pendingSpeech[...index])
            pendingSpeech = String(pendingSpeech[pendingSpeech.index(after: index)...])
            speaker.speak(sentence, settings: settings)
        }

        // 区切りが来ないまま長くなったら、読点で妥協して読み始める。
        if !force, pendingSpeech.count > 48,
           let comma = pendingSpeech.lastIndex(of: "、")
        {
            let sentence = String(pendingSpeech[...comma])
            pendingSpeech = String(pendingSpeech[pendingSpeech.index(after: comma)...])
            speaker.speak(sentence, settings: settings)
        }

        if force, !pendingSpeech.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            speaker.speak(pendingSpeech, settings: settings)
            pendingSpeech = ""
        }
    }
}
