import { useState } from "react";
import { Sparkles, X } from "lucide-react";

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { url?: string; text?: string }) => void;
}

/** 기사 링크 하나, 또는 궁금한 이슈 한 줄 → 바로 카드뉴스. */
export function StudioSheet({ open, busy, error, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");

  if (!open) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 2 || busy) return;
    if (/^https?:\/\//i.test(trimmed)) onSubmit({ url: trimmed });
    else onSubmit({ text: trimmed });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="뉴스로 카드뉴스 만들기">
        <div className="sheet-head">
          <div>
            <h2>뉴스로 만들기</h2>
            <p>기사 링크를 넣으면 본문을 읽어 카드 5장으로 정리해요.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={"기사 링크(https://…)를 붙여넣거나,\n궁금한 이슈를 한 줄로 적어 주세요.\n예) 요즘 편의점 도시락 가격 왜 이래"}
            rows={4}
            maxLength={6000}
            aria-label="기사 링크 또는 이슈 한 줄"
            data-testid="studio-input"
            autoFocus
          />
          {error && <p className="sheet-error" data-testid="studio-error">{error}</p>}
          <div className="sheet-foot">
            <p className="sheet-tip">본문에 없는 내용은 만들지 않아요. 원문 링크도 함께 붙습니다.</p>
            <button type="submit" className="cta" disabled={busy || value.trim().length < 2} data-testid="studio-submit">
              <Sparkles size={16} />
              {busy ? "카드 만드는 중…" : "카드뉴스 만들기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
