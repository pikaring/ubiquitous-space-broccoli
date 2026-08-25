import AVFoundation
import Foundation
import Speech

/// マイク入力を文字にする。端末内で処理できる場合はオフライン認識を使う。
@MainActor
final class SpeechRecognizer {
    enum RecognizerError: LocalizedError {
        case denied
        case unavailable

        var errorDescription: String? {
            switch self {
            case .denied:
                return "マイクか音声認識の許可がありません。設定アプリから許可してください。"
            case .unavailable:
                return "この端末では日本語の音声認識が使えません。"
            }
        }
    }

    /// 認識途中の文字列
    var onPartial: (@MainActor (String) -> Void)?
    /// 確定した文字列（黙ったか、停止したとき）
    var onFinal: (@MainActor (String) -> Void)?
    /// マイクの入力レベル（0…1）。アバターの「聞いている」演出に使う。
    var onLevel: (@MainActor (Float) -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var latest = ""

    private(set) var isRecording = false

    /// 認識が止まったとみなすまでの無音時間
    private let silenceInterval: TimeInterval = 1.4

    func requestAuthorization() async -> Bool {
        let speech = await withCheckedContinuation {
            (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    func start() throws {
        guard !isRecording else { return }
        guard let recognizer, recognizer.isAvailable else { throw RecognizerError.unavailable }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              AVAudioApplication.shared.recordPermission == .granted
        else { throw RecognizerError.denied }

        latest = ""

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .allowBluetooth, .duckOthers]
        )
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // 端末内で処理できるならネットワークに出さない（速いし途切れない）
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = true
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            guard let channel = buffer.floatChannelData?[0] else { return }
            let frames = Int(buffer.frameLength)
            var sum: Float = 0
            for index in 0..<frames { sum += channel[index] * channel[index] }
            let rms = frames > 0 ? (sum / Float(frames)).squareRoot() : 0
            let level = min(1, rms * 12)
            Task { @MainActor [weak self] in self?.onLevel?(level) }
        }

        engine.prepare()
        try engine.start()
        isRecording = true

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let result {
                    self.latest = result.bestTranscription.formattedString
                    self.onPartial?(self.latest)
                    self.restartSilenceTimer()
                }
                if error != nil || (result?.isFinal ?? false) {
                    self.finish()
                }
            }
        }
        restartSilenceTimer()
    }

    /// ユーザーが自分でボタンを押して止めたとき。
    func stop() {
        finish()
    }

    /// 録音だけ止めて、認識結果は捨てる。
    func cancel() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        teardownAudio()
        task?.cancel()
        task = nil
        request = nil
        latest = ""
        isRecording = false
    }

    private func restartSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceInterval, repeats: false) {
            [weak self] _ in
            Task { @MainActor [weak self] in self?.finish() }
        }
    }

    private func finish() {
        guard isRecording else { return }
        isRecording = false
        silenceTimer?.invalidate()
        silenceTimer = nil
        teardownAudio()
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil

        let text = latest.trimmingCharacters(in: .whitespacesAndNewlines)
        latest = ""
        onLevel?(0)
        if !text.isEmpty { onFinal?(text) }
    }

    private func teardownAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }
}
