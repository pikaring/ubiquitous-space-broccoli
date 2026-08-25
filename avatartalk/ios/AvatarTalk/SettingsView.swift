import AVFoundation
import UIKit
import SwiftUI

struct SettingsView: View {
    @Bindable var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var healthResult: String?
    @State private var previewSpeaker: Speaker?
    @State private var checking = false

    private let voices = Speaker.japaneseVoices

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://192.168.0.2:8787", text: $settings.bridgeURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("合言葉（BRIDGE_TOKEN）", text: $settings.bridgeToken)

                    Button {
                        Task { await checkConnection() }
                    } label: {
                        HStack {
                            Text("接続を確かめる")
                            if checking {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    if let healthResult {
                        Text(healthResult)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("ブリッジ")
                } footer: {
                    Text("母艦（Mac など）で動かしているブリッジの住所と合言葉。同じ Wi-Fi につないでおくこと。")
                }

                Section("声") {
                    Picker("声", selection: $settings.voiceIdentifier) {
                        Text("自動で選ぶ").tag("")
                        ForEach(voices, id: \.identifier) { voice in
                            Text("\(voice.name)（\(qualityLabel(voice.quality))）")
                                .tag(voice.identifier)
                        }
                    }
                    VStack(alignment: .leading) {
                        Text("速さ  \(settings.speechRate, specifier: "%.2f")")
                            .font(.footnote)
                        Slider(value: $settings.speechRate, in: 0.35...0.70)
                    }
                    VStack(alignment: .leading) {
                        Text("高さ  \(settings.pitch, specifier: "%.2f")")
                            .font(.footnote)
                        Slider(value: $settings.pitch, in: 0.70...1.60)
                    }
                    Button("この声で試す") {
                        preview()
                    }
                }

                Section {
                    Toggle("読み上げが終わったら自動で聞き始める", isOn: $settings.handsFree)
                    Toggle("字幕を表示する", isOn: $settings.showTranscript)
                    VStack(alignment: .leading) {
                        Text("アバターの色").font(.footnote)
                        Slider(value: $settings.hairHue, in: 0...1)
                    }
                } header: {
                    Text("会話とみため")
                } footer: {
                    Text("自分で用意した 3D モデルを使いたいときは、Avatar.usdz という名前で Xcode プロジェクトに入れてください。")
                }

                Section {
                    Button("設定アプリを開く") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                } footer: {
                    Text("マイクや音声認識の許可を変えたいときはこちらから。")
                }
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
    }

    private func qualityLabel(_ quality: AVSpeechSynthesisVoiceQuality) -> String {
        switch quality {
        case .premium: return "プレミアム"
        case .enhanced: return "高品質"
        default: return "標準"
        }
    }

    private func preview() {
        // 読み上げが終わるまで解放されないよう、ビューに持たせておく。
        let speaker = previewSpeaker ?? Speaker()
        previewSpeaker = speaker
        speaker.speak("こんにちは。この声でおしゃべりするね。", settings: settings)
    }

    private func checkConnection() async {
        checking = true
        defer { checking = false }
        guard let client = BridgeClient(settings: settings) else {
            healthResult = BridgeError.notConfigured.localizedDescription
            return
        }
        do {
            let body = try await client.health()
            healthResult = "つながりました → \(body)"
        } catch {
            healthResult = error.localizedDescription
        }
    }
}
