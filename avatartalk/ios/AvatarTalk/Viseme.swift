import Foundation

/// 口の形。日本語は母音が 5 つしかないので、かなから母音を拾うだけで
/// 見た目にはかなりそれらしいリップシンクになる。
enum Viseme: Equatable {
    case closed
    case a
    case i
    case u
    case e
    case o

    /// 口をどれくらい開くか（0…1）
    var openness: Float {
        switch self {
        case .closed: return 0.0
        case .a: return 1.0
        case .i: return 0.22
        case .u: return 0.5
        case .e: return 0.62
        case .o: return 0.82
        }
    }

    /// 口をどれくらい横に広げるか（1.0 が素の幅）
    var width: Float {
        switch self {
        case .closed: return 1.0
        case .a: return 1.0
        case .i: return 1.3
        case .u: return 0.6
        case .e: return 1.15
        case .o: return 0.7
        }
    }
}

enum VisemeMapper {
    private static let aRow = Set("あかさたなはまやらわがざだばぱぁゃゎゕ")
    private static let iRow = Set("いきしちにひみりぎじぢびぴぃゐ")
    private static let uRow = Set("うくすつぬふむゆるぐずづぶぷぅゅ")
    private static let eRow = Set("えけせてねへめれげぜでべぺぇゑゖ")
    private static let oRow = Set("おこそとのほもよろをごぞどぼぽぉょ")

    /// 「ひとかたまりの音」に分解する。拗音（きゃ・しゅ など）はまとめて 1 拍にする。
    static func morae(of text: String) -> [Viseme] {
        let small = Set("ゃゅょぁぃぅぇぉャュョァィゥェォ")
        var result: [Viseme] = []
        var previous: Viseme = .closed

        for character in text {
            let kana = toHiragana(character)

            // 長音記号は直前の母音を伸ばす
            if kana == "ー" || kana == "〜" {
                result.append(previous)
                continue
            }
            // 促音・撥音・句読点はいったん口を閉じる
            if kana == "っ" || kana == "ん" || kana == "、" || kana == "。"
                || kana == "！" || kana == "？" || kana == "…" || kana.isWhitespace
            {
                result.append(.closed)
                previous = .closed
                continue
            }
            guard let viseme = vowel(of: kana) else {
                // かな以外（英数字など）は口を軽く開けてごまかす
                if kana.isLetter || kana.isNumber {
                    result.append(.a)
                    previous = .a
                }
                continue
            }
            if small.contains(character), !result.isEmpty {
                // 拗音は直前の拍の母音を上書きする（「きゃ」→ あ 段ひとつ）
                result[result.count - 1] = viseme
            } else {
                result.append(viseme)
            }
            previous = viseme
        }
        return result
    }

    private static func vowel(of kana: Character) -> Viseme? {
        if aRow.contains(kana) { return .a }
        if iRow.contains(kana) { return .i }
        if uRow.contains(kana) { return .u }
        if eRow.contains(kana) { return .e }
        if oRow.contains(kana) { return .o }
        return nil
    }

    /// カタカナはひらがなに寄せる（漢字はそのまま返るので、上の判定から漏れる）
    private static func toHiragana(_ character: Character) -> Character {
        guard let scalar = character.unicodeScalars.first,
              character.unicodeScalars.count == 1,
              scalar.value >= 0x30A1, scalar.value <= 0x30F6,
              let converted = Unicode.Scalar(scalar.value - 0x60)
        else { return character }
        return Character(converted)
    }
}
