import Foundation
import Observation

/// アプリの設定。UserDefaults に素直に保存するだけ。
/// ブリッジの合言葉だけはキーチェーンに置きたくなるが、
/// 自分専用のローカルネットワーク用途なので UserDefaults にしてある。
@Observable
final class AppSettings {
    static let shared = AppSettings()

    private enum Key {
        static let bridgeURL = "bridgeURL"
        static let bridgeToken = "bridgeToken"
        static let voiceIdentifier = "voiceIdentifier"
        static let speechRate = "speechRate"
        static let pitch = "pitch"
        static let handsFree = "handsFree"
        static let showTranscript = "showTranscript"
        static let hairHue = "hairHue"
        static let sessionID = "sessionID"
    }

    private let store = UserDefaults.standard

    /// 例: http://192.168.1.10:8787
    var bridgeURL: String {
        didSet { store.set(bridgeURL, forKey: Key.bridgeURL) }
    }

    var bridgeToken: String {
        didSet { store.set(bridgeToken, forKey: Key.bridgeToken) }
    }

    /// AVSpeechSynthesisVoice の identifier。空なら日本語の既定の声。
    var voiceIdentifier: String {
        didSet { store.set(voiceIdentifier, forKey: Key.voiceIdentifier) }
    }

    /// 0.4…0.65 くらいが自然（AVSpeechUtteranceDefaultSpeechRate は 0.5）
    var speechRate: Double {
        didSet { store.set(speechRate, forKey: Key.speechRate) }
    }

    /// 0.5…2.0
    var pitch: Double {
        didSet { store.set(pitch, forKey: Key.pitch) }
    }

    /// 読み上げが終わったら自動でマイクを開き直す
    var handsFree: Bool {
        didSet { store.set(handsFree, forKey: Key.handsFree) }
    }

    var showTranscript: Bool {
        didSet { store.set(showTranscript, forKey: Key.showTranscript) }
    }

    /// 髪と服の色相（0…1）
    var hairHue: Double {
        didSet { store.set(hairHue, forKey: Key.hairHue) }
    }

    /// ブリッジ側の会話セッション ID。会話の続きを覚えておくために保存する。
    var sessionID: String? {
        didSet { store.set(sessionID, forKey: Key.sessionID) }
    }

    private init() {
        bridgeURL = store.string(forKey: Key.bridgeURL) ?? "http://192.168.0.2:8787"
        bridgeToken = store.string(forKey: Key.bridgeToken) ?? ""
        voiceIdentifier = store.string(forKey: Key.voiceIdentifier) ?? ""
        speechRate = store.object(forKey: Key.speechRate) as? Double ?? 0.52
        pitch = store.object(forKey: Key.pitch) as? Double ?? 1.08
        handsFree = store.object(forKey: Key.handsFree) as? Bool ?? false
        showTranscript = store.object(forKey: Key.showTranscript) as? Bool ?? true
        hairHue = store.object(forKey: Key.hairHue) as? Double ?? 0.58
        sessionID = store.string(forKey: Key.sessionID)
    }

    var isConfigured: Bool {
        URL(string: bridgeURL) != nil && !bridgeToken.isEmpty
    }
}
