import { useCallback, useEffect, useMemo, useState } from "react";
import type { Issue, PollSnapshot, TrendingResponse } from "./types";
import {
  STATIC_BUILD,
  createBriefing,
  emptyPoll,
  fetchIssue,
  fetchPolls,
  fetchTrending,
  sendComment,
  sendLike,
  sendVote,
} from "./lib/api";
import { copyText, issueLink, shareIssue } from "./lib/share";
import { Header } from "./components/Header";
import { CardNewsViewer } from "./components/CardNewsViewer";
import { CardPreview } from "./components/CardPreview";
import { FeedCard, HeroCard } from "./components/FeedCard";
import { StudioSheet } from "./components/StudioSheet";
import { Toast } from "./components/Toast";

const LIVE_URL = "https://issue-factbomb-board.vercel.app";

export default function App() {
  const [doc, setDoc] = useState<TrendingResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [polls, setPolls] = useState<Record<string, PollSnapshot>>({});
  const [localOnly, setLocalOnly] = useState(false);
  const [extra, setExtra] = useState<Issue[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [startSlide, setStartSlide] = useState(0);
  const [voting, setVoting] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadPolls = useCallback(async (issues: Issue[]) => {
    try {
      const res = await fetchPolls(issues.map((issue) => issue.id), issues);
      if (res.polls) setPolls((prev) => ({ ...prev, ...res.polls }));
      if (res.localOnly) setLocalOnly(true);
    } catch {
      /* 투표 집계는 없어도 카드는 읽을 수 있습니다 */
    }
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      if (STATIC_BUILD) {
        setStatus("error");
        setError("static");
        return;
      }
      if (refresh) setRefreshing(true);
      else setStatus("loading");
      try {
        const res = await fetchTrending({ refresh });
        if (res.ok && res.issues && res.issues.length > 0) {
          setDoc(res);
          setStatus("ready");
          setError(null);
          void loadPolls(res.issues);
        } else {
          setError(res.message ?? "뉴스를 가져오지 못했어요.");
          setStatus((prev) => (prev === "ready" ? "ready" : "error"));
        }
      } catch {
        setError("뉴스 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      } finally {
        setRefreshing(false);
      }
    },
    [loadPolls],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /* 공유 링크(#/i/<id>)로 들어온 경우 */
  useEffect(() => {
    const sync = () => {
      const match = location.hash.match(/^#\/i\/([A-Za-z0-9_-]{6,64})$/);
      setViewerId(match ? match[1] : null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const issues = useMemo(() => {
    const list = [...(doc?.issues ?? []), ...extra];
    const seen = new Set<string>();
    const unique = list.filter((issue) => (seen.has(issue.id) ? false : (seen.add(issue.id), true)));
    // 화제성(제목·키워드)과 논란 온도를 섞어 정렬 — 인스타에 올렸을 때 반응이 붙는 카드가 위로.
    const rank = (issue: Issue) => (issue.buzz ?? 0) * 0.6 + (issue.temp ?? issue.buzz ?? 0) * 0.4;
    return unique.sort((a, b) => rank(b) - rank(a) || b.publishedAt - a.publishedAt);
  }, [doc, extra]);

  const viewerIssue = useMemo(() => issues.find((issue) => issue.id === viewerId) ?? null, [issues, viewerId]);

  /* 목록에 없는 카드(공유 링크로 바로 들어온 경우)는 서버에서 하나만 다시 꺼옵니다. */
  useEffect(() => {
    if (!viewerId || viewerIssue) return;
    let cancelled = false;
    fetchIssue(viewerId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.issue) {
          setExtra((prev) => [res.issue as Issue, ...prev]);
          void loadPolls([res.issue as Issue]);
        } else {
          setToast(res.message ?? "카드를 열 수 없어요.");
          closeViewer();
        }
      })
      .catch(() => {
        if (!cancelled) setToast("카드를 불러오지 못했어요.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, viewerIssue, loadPolls]);

  const openIssue = (issue: Issue, slide = 0) => {
    setStartSlide(slide);
    setViewerId(issue.id);
    history.replaceState(null, "", `#/i/${issue.id}`);
    if (!polls[issue.id]) void loadPolls([issue]);
  };

  const closeViewer = () => {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setViewerId(null);
  };

  const onVote = async (issue: Issue, choice: "a" | "b") => {
    const current = polls[issue.id] ?? emptyPoll(issue);
    const optimistic: PollSnapshot = {
      ...current,
      counts: {
        a: current.counts.a + (choice === "a" ? 1 : 0) - (current.my === "a" ? 1 : 0),
        b: current.counts.b + (choice === "b" ? 1 : 0) - (current.my === "b" ? 1 : 0),
      },
      my: choice,
    };
    optimistic.total = optimistic.counts.a + optimistic.counts.b;
    setPolls((prev) => ({ ...prev, [issue.id]: optimistic }));
    setVoting(true);
    try {
      const res = await sendVote(issue, choice);
      if (res.poll) setPolls((prev) => ({ ...prev, [issue.id]: res.poll as PollSnapshot }));
      if (res.localOnly) {
        setLocalOnly(true);
        setToast("연결이 없어 표가 이 기기에만 남았어요.");
      }
    } catch {
      setLocalOnly(true);
      setToast("연결이 없어 표가 이 기기에만 남았어요.");
    } finally {
      setVoting(false);
    }
  };

  const onComment = async (issue: Issue, side: "a" | "b", text: string): Promise<boolean> => {
    try {
      const res = await sendComment(issue, side, text);
      if (res.poll) {
        const nextPoll = res.poll as PollSnapshot;
        setPolls((prev) => {
          const current = prev[issue.id];
          if (res.ok || !current) return { ...prev, [issue.id]: nextPoll };
          // 연결이 끊겨도 화면의 투표 수는 유지하고, 방금 쓴 댓글만 이 기기에 붙입니다.
          return {
            ...prev,
            [issue.id]: { ...current, comments: nextPoll.comments, commentCount: nextPoll.comments.length },
          };
        });
      }
      if (res.localOnly) {
        setLocalOnly(true);
        setToast("연결이 없어 댓글이 이 기기에만 남았어요.");
      }
    } catch {
      setLocalOnly(true);
      setToast("연결이 없어 댓글이 이 기기에만 남았어요.");
    }
    return true;
  };

  const onLike = async (issue: Issue, commentId: string) => {
    setPolls((prev) => {
      const poll = prev[issue.id];
      if (!poll) return prev;
      const comments = poll.comments.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              liked: !comment.liked,
              likes: Math.max(0, comment.likes + (comment.liked ? -1 : 1)),
            }
          : comment,
      );
      return { ...prev, [issue.id]: { ...poll, comments } };
    });
    const res = await sendLike(issue, commentId);
    if (res.poll) setPolls((prev) => ({ ...prev, [issue.id]: res.poll as PollSnapshot }));
    if (res.localOnly) setLocalOnly(true);
  };

  const onShare = async (issue: Issue) => {
    const result = await shareIssue(issue);
    if (result === "shared") setToast("공유했어요.");
    else if (result === "copied") setToast("카드 링크를 복사했어요.");
    else setToast("공유하지 못했어요. 주소창의 링크를 복사해 주세요.");
  };

  const onCopy = async (issue: Issue) => {
    const ok = await copyText(`${issue.hook}\n${issueLink(issue)}`);
    setToast(ok ? "링크를 복사했어요." : "복사하지 못했어요.");
  };

  const onSubmitStudio = async (input: { url?: string; text?: string }) => {
    setStudioBusy(true);
    setStudioError(null);
    try {
      const res = await createBriefing(input);
      if (res.ok && res.issue) {
        const created = res.issue;
        setExtra((prev) => [created, ...prev]);
        void loadPolls([created]);
        setStudioOpen(false);
        openIssue(created);
        if (res.notice) setToast(res.notice);
      } else {
        setStudioError(res.message ?? "카드를 만들지 못했어요.");
      }
    } catch {
      setStudioError("서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setStudioBusy(false);
    }
  };

  const feed = issues.slice(1);
  const hero = issues[0];
  // 하루에 3~4장 올리는 흐름 — 오늘 올릴 만한 카드를 위에서부터 표시합니다.
  const recommendedIds = new Set(issues.slice(0, 4).map((issue) => issue.id));
  const feedTotal = (doc?.feeds ?? []).length || 19;

  return (
    <div className="app">
      <Header
        generatedAt={doc?.generatedAt ?? null}
        issueCount={issues.length}
        feedOk={(doc?.feeds ?? []).filter((feedItem) => feedItem.ok).length}
        feedTotal={(doc?.feeds ?? []).length}
        aiOn={Boolean(doc?.ai)}
        refreshing={refreshing}
        onRefresh={() => void load(true)}
        onOpenStudio={() => setStudioOpen(true)}
      />

      <main className="main">
        {STATIC_BUILD ? (
          <section className="panel" data-testid="static-notice">
            <h2>이 주소는 정적 배포본이에요</h2>
            <p>
              실시간 뉴스 수집은 서버가 필요합니다. 지금 쓰실 주소는{" "}
              <a href={LIVE_URL} target="_blank" rel="noreferrer noopener">
                {LIVE_URL}
              </a>
              이에요. 그쪽에서 오늘의 실제 뉴스 카드와 투표가 동작합니다.
            </p>
          </section>
        ) : status === "loading" ? (
          <LoadingSkeleton />
        ) : status === "error" || !hero ? (
          <section className="panel" data-testid="error-panel">
            <h2>오늘의 뉴스를 가져오지 못했어요</h2>
            <p>{error ?? "잠시 뒤 다시 시도해 주세요."}</p>
            <button type="button" className="cta" onClick={() => void load(true)}>
              다시 시도
            </button>
          </section>
        ) : (
          <>
            {doc?.notice && <p className="notice" data-testid="notice">{doc.notice}</p>}

            <section className="masthead" data-testid="masthead">
              <div className="masthead-rule">
                <span>DAILY INDEX</span>
                <span>{issues.length} STORIES</span>
              </div>
              <h2 className="masthead-title">
                오늘, 어디서
                <br />
                갈렸나<span className="masthead-dot">.</span>
              </h2>
              <p className="masthead-sub">
                언론사 {feedTotal}곳의 실제 기사만 모아 인스타 카드뉴스 5장으로. 오늘 올릴 3~4장을 화제성 순으로 골라 놓았어요.
              </p>
            </section>

            <section className="hero-wrap">
              <div className="hero-label">
                <span className="hero-label-dot" aria-hidden="true" />
                <span>오늘 가장 뜨거운 이슈</span>
                <span className="hero-label-line" aria-hidden="true" />
              </div>
              <HeroCard issue={hero} poll={polls[hero.id] ?? null} onOpen={openIssue} />
            </section>

            <CardPreview issue={hero} onOpen={(slide) => openIssue(hero, slide)} />

            <section className="feed">
              <div className="section-head">
                <h2>
                  오늘의 카드뉴스 <em>{feed.length}</em>
                </h2>
                <span className="section-note">화제성 순 · 위 4장은 오늘 올릴 만한 카드</span>
              </div>
              <div className="grid">
                {feed.map((issue, index) => (
                  <FeedCard
                    key={issue.id}
                    issue={issue}
                    index={index + 1}
                    poll={polls[issue.id] ?? null}
                    recommended={recommendedIds.has(issue.id)}
                    onOpen={openIssue}
                  />
                ))}
              </div>
            </section>

            <section className="how">
              <h2>
                이렇게 <em>한다</em>
              </h2>
              <ol>
                <li>
                  <b>01</b>
                  <span>언론사 RSS {feedTotal}곳에서 오늘 기사를 긁어옵니다 — 연예·사건·소비자 논란까지</span>
                </li>
                <li>
                  <b>02</b>
                  <span>화제성으로 줄 세우고, AI가 표지 훅·팩트 3줄·쟁점·A vs B로 카드 5장을 만듭니다</span>
                </li>
                <li>
                  <b>03</b>
                  <span>PNG로 저장해 인스타에 올리고, 여기서 투표·토론으로 이어집니다</span>
                </li>
              </ol>
            </section>
          </>
        )}
      </main>

      <footer className="foot">
        <p className="foot-main">카드는 실제 언론사 기사로만 만듭니다. 원문 링크는 항상 카드에 붙습니다.</p>
        <p className="foot-dim">
          {doc?.ai ? `AI ${doc.ai.provider} · ${doc.ai.model}` : "AI 요약 꺼짐"} ·{" "}
          {doc?.mode === "shared" ? "투표 집계 공용 저장" : "투표는 이 기기 기준"} · 이슈온도계
        </p>
      </footer>

      {viewerIssue && (
        <CardNewsViewer
          key={viewerIssue.id}
          issue={viewerIssue}
          poll={polls[viewerIssue.id] ?? emptyPoll(viewerIssue)}
          voting={voting}
          localOnly={localOnly}
          startIndex={startSlide}
          onClose={closeViewer}
          onVote={(choice) => void onVote(viewerIssue, choice)}
          onComment={(side, text) => onComment(viewerIssue, side, text)}
          onLike={(commentId) => void onLike(viewerIssue, commentId)}
          onShare={() => void onShare(viewerIssue)}
          onCopy={() => void onCopy(viewerIssue)}
          onCopyCaption={async (caption) => {
            const ok = await copyText(caption);
            setToast(ok ? "캡션을 복사했어요. 인스타에 붙여넣으세요." : "복사하지 못했어요.");
          }}
          onToast={setToast}
        />
      )}

      <StudioSheet
        open={studioOpen}
        busy={studioBusy}
        error={studioError}
        onClose={() => {
          setStudioOpen(false);
          setStudioError(null);
        }}
        onSubmit={(input) => void onSubmitStudio(input)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="skeleton-wrap" data-testid="loading">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-head" />
      <div className="grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
      <p className="skeleton-msg">오늘 언론사 RSS에서 기사를 모으고 있어요…</p>
    </div>
  );
}
