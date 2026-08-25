import Foundation

/// ブリッジから流れてくる Server-Sent Events。
enum BridgeEvent {
    case session(String)
    case delta(String)
    case done
    case failure(String)
}

enum BridgeError: LocalizedError {
    case badURL
    case notConfigured
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "ブリッジの URL が正しくありません。"
        case .notConfigured:
            return "設定でブリッジの URL と合言葉を入力してください。"
        case .http(401, _):
            return "合言葉が違います（401）。BRIDGE_TOKEN を確認してください。"
        case let .http(code, body):
            return "ブリッジがエラーを返しました（HTTP \(code)）。\(body)"
        }
    }
}

/// ブリッジ（Node 側）とやり取りするクライアント。
struct BridgeClient {
    let baseURL: URL
    let token: String

    init?(settings: AppSettings) {
        guard let url = URL(string: settings.bridgeURL.trimmingCharacters(in: .whitespaces)),
              url.scheme != nil, url.host != nil, !settings.bridgeToken.isEmpty
        else { return nil }
        self.baseURL = url
        self.token = settings.bridgeToken
    }

    /// URLSession は使い捨てにすると溜まっていくので、1 つだけ作って共有する。
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        // 考えている間は無言なので、待ち時間は長めに取る。
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 300
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration)
    }()

    private var session: URLSession { Self.session }

    func health() async throws -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("health"))
        request.timeoutInterval = 10
        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = String(data: data, encoding: .utf8) ?? ""
        guard code == 200 else { throw BridgeError.http(code, body) }
        return body
    }

    /// 返事を 1 文字ずつ流してもらう。
    func chat(message: String, sessionID: String?) -> AsyncThrowingStream<BridgeEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: baseURL.appendingPathComponent("v1/chat"))
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    var payload: [String: Any] = ["message": message]
                    if let sessionID { payload["sessionId"] = sessionID }
                    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

                    let (bytes, response) = try await session.bytes(for: request)
                    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard code == 200 else {
                        var body = ""
                        for try await line in bytes.lines { body += line }
                        throw BridgeError.http(code, body)
                    }

                    var eventName = "message"
                    var dataLine = ""

                    for try await line in bytes.lines {
                        if line.isEmpty {
                            // 空行 = 1 フレームの終わり
                            if !dataLine.isEmpty {
                                emit(eventName, dataLine, to: continuation)
                            }
                            eventName = "message"
                            dataLine = ""
                            continue
                        }
                        if line.hasPrefix(":") { continue } // コメント（keep-alive）
                        if line.hasPrefix("event:") {
                            eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataLine += String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func emit(
        _ event: String,
        _ payload: String,
        to continuation: AsyncThrowingStream<BridgeEvent, Error>.Continuation
    ) {
        guard let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        switch event {
        case "delta":
            if let text = object["text"] as? String { continuation.yield(.delta(text)) }
        case "session":
            if let id = object["sessionId"] as? String { continuation.yield(.session(id)) }
        case "done":
            continuation.yield(.done)
        case "error":
            continuation.yield(.failure(object["message"] as? String ?? "不明なエラー"))
        default:
            break
        }
    }
}
