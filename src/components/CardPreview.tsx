import { ArrowUpRight, ImageIcon } from "lucide-react";
import type { Issue } from "../types";
import { useSlidePreview } from "../lib/useSlidePreview";
import { useActiveBrand } from "../lib/prefs";

interface Props {
  issue: Issue;
  onOpen: (slide: number) => void;
}

/**
 * 카드뉴스 5장 미리보기 — 저장 전에 어떤 순서로 읽히는지 한눈에 봅니다.
 * 1번 칸은 실제로 그린 표지(= 인스타에 올라갈 썸네일)를 그대로 보여 주고,
 * 카드를 누르면 그 장부터 뷰어가 열립니다.
 */
export function CardPreview({ issue, onOpen }: Props) {
  const sides = issue.sides;
  const brand = useActiveBrand();
  const coverUrl = useSlidePreview(issue, 0, { theme: brand.theme, handle: brand.handle });

  return (
    <section className="preview" data-testid="card-preview">
      <div className="section-head">
        <h2>
          카드뉴스 <em>5장</em>
        </h2>
        <span className="section-note">1번이 인스타 썸네일 · 누르면 그 장부터</span>
      </div>

      <div className="preview-rail">
        <button
          type="button"
          className="pv pv-cover"
          onClick={() => onOpen(0)}
          aria-label="표지부터 열기"
          data-testid="preview-cover"
        >
          {coverUrl ? (
            <img className="pv-cover-img" src={coverUrl} alt="" width={1080} height={1350} draggable={false} />
          ) : (
            <span className="pv-cover-skeleton" aria-hidden="true">
              <ImageIcon size={22} />
              <span>표지 그리는 중</span>
            </span>
          )}
          <span className="pv-badge">1 · 표지</span>
        </button>

        <button type="button" className="pv pv-facts" onClick={() => onOpen(1)} aria-label="팩트 3줄부터 열기">
          <span className="pv-step">02</span>
          <span className="pv-chip">무슨 일인데</span>
          <span className="pv-facts-list">
            {issue.facts.slice(0, 3).map((fact, index) => (
              <span className="pv-fact" key={index}>
                <b>{index + 1}</b>
                <span>{fact}</span>
              </span>
            ))}
          </span>
          <span className="pv-more">{issue.source}</span>
        </button>

        <button type="button" className="pv pv-issue" onClick={() => onOpen(2)} aria-label="쟁점부터 열기">
          <span className="pv-step">03</span>
          <span className="pv-chip">왜 지금 뜨나</span>
          <span className="pv-quote" aria-hidden="true">
            “
          </span>
          <span className="pv-text is-strong">{issue.point || issue.kicker}</span>
          {issue.background && <span className="pv-text">{issue.background}</span>}
          <span className="pv-more">{issue.source}</span>
        </button>

        <button type="button" className="pv pv-sides" onClick={() => onOpen(3)} aria-label="A vs B부터 열기">
          <span className="pv-step">04</span>
          <span className="pv-chip">A vs B</span>
          <span className="pv-side" data-side="a">
            <b>A</b>
            {sides?.labelA ?? "한쪽"}
          </span>
          <span className="pv-vs" aria-hidden="true">
            VS
          </span>
          <span className="pv-side" data-side="b">
            <b>B</b>
            {sides?.labelB ?? "다른 쪽"}
          </span>
        </button>

        <button type="button" className="pv pv-vote" onClick={() => onOpen(4)} aria-label="투표 카드부터 열기">
          <span className="pv-step">05</span>
          <span className="pv-chip">당신의 선택</span>
          <span className="pv-q">{issue.poll.question}</span>
          <span className="pv-opt" data-side="a">
            A {issue.poll.a}
          </span>
          <span className="pv-opt" data-side="b">
            B {issue.poll.b}
          </span>
        </button>
      </div>

      <p className="preview-foot">
        PNG 1080×1350 · 인스타 4:5 · 캡션 복사까지 <ArrowUpRight size={12} />
      </p>
    </section>
  );
}
