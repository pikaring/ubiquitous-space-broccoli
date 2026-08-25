import SwiftUI

struct ContentView: View {
    @State private var viewModel = ConversationViewModel()
    private let settings = AppSettings.shared
    @State private var showSettings = false
    @State private var typed = ""
    @FocusState private var keyboardFocused: Bool

    var body: some View {
        ZStack {
            background
            AvatarView(controller: viewModel.avatar, hue: settings.hairHue)
                .id(settings.hairHue)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Spacer(minLength: 0)
                if let error = viewModel.errorMessage {
                    errorBanner(error)
                }
                if settings.showTranscript {
                    transcript
                }
                inputBar
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsView(settings: settings)
        }
        .task {
            await viewModel.prepare()
        }
    }

    // MARK: - パーツ

    private var background: some View {
        LinearGradient(
            colors: [
                Color(hue: settings.hairHue, saturation: 0.35, brightness: 0.30),
                Color(hue: (settings.hairHue + 0.12).truncatingRemainder(dividingBy: 1),
                      saturation: 0.45, brightness: 0.12),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var header: some View {
        HStack {
            statusPill
            Spacer()
            Button {
                viewModel.resetConversation()
            } label: {
                Image(systemName: "arrow.counterclockwise")
                    .font(.title3)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("会話をリセット")

            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.title3)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("設定")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var statusPill: some View {
        let (text, symbol): (String, String) = switch viewModel.state {
        case .idle: ("話しかけてね", "waveform")
        case .listening: ("聞いています", "mic.fill")
        case .thinking: ("考えています", "ellipsis")
        case .speaking: ("話しています", "speaker.wave.2.fill")
        }
        return Label(text, systemImage: symbol)
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message).font(.footnote)
            Spacer()
            Button("閉じる") { viewModel.dismissError() }
                .font(.footnote.weight(.semibold))
        }
        .foregroundStyle(.white)
        .padding(12)
        .background(Color.red.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.messages) { message in
                        bubble(for: message).id(message.id)
                    }
                    if !viewModel.partialInput.isEmpty {
                        bubble(for: ChatMessage(role: .you, text: viewModel.partialInput))
                            .opacity(0.55)
                            .id("partial")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .frame(maxHeight: 220)
            .mask(
                LinearGradient(
                    colors: [.clear, .black, .black, .black],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .onChange(of: viewModel.messages.last?.text) {
                if let last = viewModel.messages.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
    }

    private func bubble(for message: ChatMessage) -> some View {
        HStack {
            if message.role == .you { Spacer(minLength: 40) }
            Text(message.text.isEmpty ? "…" : message.text)
                .font(.callout)
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    message.role == .you
                        ? AnyShapeStyle(Color.white.opacity(0.22))
                        : AnyShapeStyle(.ultraThinMaterial),
                    in: RoundedRectangle(cornerRadius: 16)
                )
            if message.role == .avatar { Spacer(minLength: 40) }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 12) {
            TextField("文字で話しかける", text: $typed)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(.ultraThinMaterial, in: Capsule())
                .focused($keyboardFocused)
                .submitLabel(.send)
                .onSubmit(sendTyped)

            Button(action: viewModel.tapMicrophone) {
                ZStack {
                    Circle()
                        .fill(micColor)
                        .frame(width: 62, height: 62)
                    Image(systemName: micSymbol)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                }
                .shadow(color: micColor.opacity(0.5), radius: 12)
            }
            .accessibilityLabel(micAccessibilityLabel)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var micColor: Color {
        switch viewModel.state {
        case .idle: Color(hue: settings.hairHue, saturation: 0.55, brightness: 0.75)
        case .listening: .red
        case .thinking: .orange
        case .speaking: .green
        }
    }

    private var micSymbol: String {
        switch viewModel.state {
        case .idle: "mic.fill"
        case .listening: "stop.fill"
        case .thinking: "xmark"
        case .speaking: "speaker.slash.fill"
        }
    }

    private var micAccessibilityLabel: String {
        switch viewModel.state {
        case .idle: "話しかける"
        case .listening: "話し終わった"
        case .thinking: "返事を取り消す"
        case .speaking: "読み上げを止める"
        }
    }

    private func sendTyped() {
        let text = typed
        typed = ""
        keyboardFocused = false
        viewModel.send(text)
    }
}

#Preview {
    ContentView()
}
