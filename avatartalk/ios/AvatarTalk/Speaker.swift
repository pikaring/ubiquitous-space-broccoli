import AVFoundation
import Foundation

/// 読み上げ担当。文が届くたびにキューに足していくので、
/// Claude の返事が全部そろうのを待たずにしゃべり始められる。
@MainActor
final class Speaker: NSObject {
    /// いま口をどの形にするか
    var onViseme: (@MainActor (Viseme) -> Void)?
    /// しゃべり始め／しゃべり終わり
    var onStateChange: (@MainActor (Bool) -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private var mouthTimer: Timer?
    private var morae: [Viseme] = []
    private var moraIndex = 0
    private var pending = 0

    private(set) var isSpeaking = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, settings: AppSettings) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = Self.voice(for: settings)
        utterance.rate = Float(settings.speechRate)
        utterance.pitchMultiplier = Float(settings.pitch)
        utterance.postUtteranceDelay = 0.05

        pending += 1
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers]
            )
            try audioSession.setActive(true)
        } catch {
            // 音が出ないだけで会話自体は続けられるので、握りつぶす。
        }
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        pending = 0
        stopMouth()
    }

    nonisolated static func voice(for settings: AppSettings) -> AVSpeechSynthesisVoice? {
        if !settings.voiceIdentifier.isEmpty,
           let voice = AVSpeechSynthesisVoice(identifier: settings.voiceIdentifier)
        {
            return voice
        }
        // 拡張版（より自然な声）が入っていればそちらを優先する
        let japanese = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("ja") }
        return japanese.first(where: { $0.quality == .premium })
            ?? japanese.first(where: { $0.quality == .enhanced })
            ?? japanese.first
            ?? AVSpeechSynthesisVoice(language: "ja-JP")
    }

    nonisolated static var japaneseVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("ja") }
            .sorted { $0.quality.rawValue > $1.quality.rawValue }
    }

    // MARK: - 口の動き

    /// 読み上げ中の区間が変わるたびに、その区間のかなを一定間隔で口に流す。
    /// 正確な音素タイミングは取れないが、区間コールバックのたびに位置が
    /// 補正されるので、見た目には十分そろって見える。
    private func scheduleMouth(for text: String, rate: Float) {
        morae = VisemeMapper.morae(of: text)
        moraIndex = 0
        guard !morae.isEmpty else { return }

        // AVSpeechUtteranceDefaultSpeechRate (0.5) のとき 1 拍 ≒ 0.13 秒。
        let interval = max(0.045, 0.13 * Double(AVSpeechUtteranceDefaultSpeechRate / max(rate, 0.1)))
        mouthTimer?.invalidate()
        mouthTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] timer in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.moraIndex < self.morae.count else {
                    timer.invalidate()
                    self.onViseme?(.closed)
                    return
                }
                self.onViseme?(self.morae[self.moraIndex])
                self.moraIndex += 1
            }
        }
    }

    private func stopMouth() {
        mouthTimer?.invalidate()
        mouthTimer = nil
        morae = []
        moraIndex = 0
        onViseme?(.closed)
        if isSpeaking {
            isSpeaking = false
            onStateChange?(false)
        }
    }
}

extension Speaker: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didStart utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in
            if !isSpeaking {
                isSpeaking = true
                onStateChange?(true)
            }
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        let full = utterance.speechString as NSString
        guard characterRange.location + characterRange.length <= full.length else { return }
        let chunk = full.substring(with: characterRange)
        let rate = utterance.rate
        Task { @MainActor in
            scheduleMouth(for: chunk, rate: rate)
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in
            pending = max(0, pending - 1)
            if pending == 0 { stopMouth() }
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in
            pending = max(0, pending - 1)
            if pending == 0 { stopMouth() }
        }
    }
}
