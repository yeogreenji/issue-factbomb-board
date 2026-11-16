import { useCallback, useEffect, useMemo, useState } from "react";
import type { Issue, PollSnapshot, TrendingResponse } from "./types";
import {
  STATIC_BUILD,
  createBriefing,
  emptyPoll,
  fetchIssue,
  fetchPolls,
  fetchTrending,
  sendReaction,
  sendVote,
} from "./lib/api";
import { copyText, issueLink, shareIssue } from "./lib/share";
import { Header } from "./components/Header";
import { CardNewsViewer } from "./components/CardNewsViewer";
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
  const [extra, setExtra] = useState<Issue[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadPolls = useCallback(async (issues: Issue[]) => {
    try {
      const res = await fetchPolls(issues.map((issue) => issue.id));
      if (res.ok && res.polls) setPolls((prev) => ({ ...prev, ...res.polls }));
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
    return unique.sort((a, b) => (b.temp ?? -1) - (a.temp ?? -1) || b.publishedAt - a.publishedAt);
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

  const openIssue = (issue: Issue) => {
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
      if (res.ok && res.poll) setPolls((prev) => ({ ...prev, [issue.id]: res.poll as PollSnapshot }));
      else throw new Error(res.message ?? "vote failed");
    } catch {
      setToast("연결이 없어 표가 이 기기에만 남았어요.");
    } finally {
      setVoting(false);
    }
  };

  const onReact = async (issue: Issue, text: string): Promise<boolean> => {
    const current = polls[issue.id] ?? emptyPoll(issue);
    try {
      const res = await sendReaction(issue, text);
      if (res.ok && res.poll) {
        setPolls((prev) => ({ ...prev, [issue.id]: res.poll as PollSnapshot }));
        return true;
      }
      throw new Error(res.message ?? "reaction failed");
    } catch {
      setPolls((prev) => ({
        ...prev,
        [issue.id]: {
          ...current,
          reactions: [...current.reactions, { text, at: Date.now(), tag: "나" }].slice(-30),
        },
      }));
      setToast("연결이 없어 반응이 이 기기에만 남았어요.");
      return true;
    }
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

            <section className="hero-wrap">
              <div className="hero-label">
                <span className="hero-label-dot" aria-hidden="true" />
                오늘 가장 뜨거운 이슈
              </div>
              <HeroCard issue={hero} poll={polls[hero.id] ?? null} onOpen={openIssue} />
            </section>

            <section className="feed">
              <div className="feed-head">
                <h2>오늘의 카드뉴스</h2>
                <span>{feed.length}건 · 온도 높은 순</span>
              </div>
              <div className="grid">
                {feed.map((issue, index) => (
                  <FeedCard
                    key={issue.id}
                    issue={issue}
                    index={index + 1}
                    poll={polls[issue.id] ?? null}
                    onOpen={openIssue}
                  />
                ))}
              </div>
            </section>

            <section className="how">
              <h2>이렇게 씁니다</h2>
              <ol>
                <li>
                  <b>1</b>
                  <span>오늘 언론사 RSS에서 실제 기사를 긁어옵니다</span>
                </li>
                <li>
                  <b>2</b>
                  <span>AI가 한 줄 훅·팩트 2줄·양쪽 입장으로 카드 3장을 만듭니다</span>
                </li>
                <li>
                  <b>3</b>
                  <span>A vs B 투표하고 친구에게 링크로 보냅니다</span>
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
          issue={viewerIssue}
          poll={polls[viewerIssue.id] ?? emptyPoll(viewerIssue)}
          voting={voting}
          onClose={closeViewer}
          onVote={(choice) => void onVote(viewerIssue, choice)}
          onReact={(text) => onReact(viewerIssue, text)}
          onShare={() => void onShare(viewerIssue)}
          onCopy={() => void onCopy(viewerIssue)}
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
