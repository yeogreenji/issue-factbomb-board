import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue, View } from './types';
import { useBoard, type BoardApi } from './hooks/useBoard';
import { SiteHeader, type NavKey } from './components/SiteHeader';
import { Ticker } from './components/Ticker';
import { FeedPage } from './components/FeedPage';
import { RankingPage } from './components/RankingPage';
import { IssueDetail } from './components/IssueDetail';
import { EditorStudio } from './components/EditorStudio';
import { Footer } from './components/Footer';
import { ShareModal } from './components/ShareModal';
import { Toast } from './components/Toast';
import { bestEntries } from './lib/selectors';

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('issue/')) {
    return { name: 'issue', id: raw.slice('issue/'.length) };
  }
  if (raw === 'ranking') return { name: 'ranking' };
  if (raw === 'editor') return { name: 'editor' };
  return { name: 'feed' };
}

function hashFor(key: NavKey): string {
  return key === 'feed' ? '#/' : `#/${key}`;
}

export default function App() {
  const board = useBoard();
  const [view, setView] = useState<View>(() => parseHash());
  const [shareIssueId, setShareIssueId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  const notify = useCallback((text: string) => {
    setToast((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setView(parseHash());
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((key: NavKey) => {
    window.location.hash = hashFor(key);
  }, []);

  const openIssue = useCallback((id: string) => {
    window.location.hash = `#/issue/${id}`;
  }, []);

  const shareIssue = useMemo(
    () => (shareIssueId ? board.issueById(shareIssueId) : undefined),
    [shareIssueId, board],
  );

  const shareComment = useMemo(() => {
    if (!shareIssue) return undefined;
    return bestEntries(
      board.comments.filter((comment) => comment.issueId === shareIssue.id),
      [shareIssue],
      board.temps,
      1,
    )[0]?.comment;
  }, [shareIssue, board.comments, board.temps]);

  const handlePublish = useCallback(
    (input: Parameters<BoardApi['publish']>[0]) => {
      const issue = board.publish(input);
      notify('발행 완료 — 뉴스룸 최상단에 올렸습니다.');
      openIssue(issue.id);
      return issue;
    },
    [board, notify, openIssue],
  );

  const handleComment = useCallback(
    (issueId: string, text: string) => {
      if (text.trim().length === 0) {
        notify('한 줄 팩폭을 입력해 주세요.');
        return false;
      }
      const comment = board.addComment(issueId, text);
      if (!comment) return false;
      notify('팩폭을 등록했습니다. 좋아요로 순위가 올라갑니다.');
      return true;
    },
    [board, notify],
  );

  const currentIssue: Issue | undefined =
    view.name === 'issue' ? board.issueById(view.id) : undefined;

  const rankingEntries = useMemo(
    () => bestEntries(board.comments, board.issues, board.temps, board.comments.length),
    [board.comments, board.issues, board.temps],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteHeader view={view} onNavigate={navigate} issueCount={board.issues.length} />
      {view.name === 'feed' ? (
        <Ticker issues={board.issues} temps={board.temps} onOpenIssue={openIssue} />
      ) : null}

      <main className="flex-1">
        {view.name === 'feed' ? (
          <FeedPage
            board={board}
            onOpenIssue={openIssue}
            onShare={(issue) => setShareIssueId(issue.id)}
            onNavigate={navigate}
          />
        ) : null}

        {view.name === 'ranking' ? (
          <RankingPage
            entries={rankingEntries}
            liked={board.likedComments}
            onLike={board.toggleLike}
            onOpenIssue={openIssue}
            onBack={() => navigate('feed')}
          />
        ) : null}

        {view.name === 'editor' ? (
          <EditorStudio onPublish={handlePublish} onToast={notify} />
        ) : null}

        {view.name === 'issue' ? (
          currentIssue ? (
            <IssueDetail
              issue={currentIssue}
              temp={board.temps[currentIssue.id] ?? 0}
              votes={board.votesOf(currentIssue.id)}
              myVote={board.myVotes[currentIssue.id]}
              comments={board.commentsOf(currentIssue.id)}
              liked={board.likedComments}
              related={board.issues
                .filter((issue) => issue.category === currentIssue.category && issue.id !== currentIssue.id)
                .sort((a, b) => (board.temps[b.id] ?? 0) - (board.temps[a.id] ?? 0))
                .slice(0, 3)
                .map((issue) => ({ issue, temp: board.temps[issue.id] ?? 0 }))}
              onVote={(reaction) => board.vote(currentIssue.id, reaction)}
              onLike={board.toggleLike}
              onComment={(text) => handleComment(currentIssue.id, text)}
              onShare={() => setShareIssueId(currentIssue.id)}
              onBack={() => navigate('feed')}
              onOpenIssue={openIssue}
            />
          ) : (
            <div className="mx-auto w-full max-w-[1240px] px-4 py-24 text-center">
              <p className="serif text-[20px] font-bold text-ink">이슈를 찾을 수 없습니다.</p>
              <p className="mt-2 text-[12.5px] text-muted">주소가 바뀌었거나 삭제된 이슈입니다.</p>
              <button
                type="button"
                onClick={() => navigate('feed')}
                className="mt-5 rounded-full bg-ink px-4 py-2 text-[12px] font-bold text-paper transition hover:bg-heat"
              >
                뉴스룸으로
              </button>
            </div>
          )
        ) : null}
      </main>

      <Footer
        onNavigate={navigate}
        onReset={() => {
          const ok = window.confirm('투표·팩폭·발행한 이슈를 모두 지우고 데모 데이터로 돌아갑니다. 계속할까요?');
          if (!ok) return;
          board.reset();
          notify('데모 데이터로 초기화했습니다.');
          navigate('feed');
        }}
      />

      {shareIssue ? (
        <ShareModal
          issue={shareIssue}
          temp={board.temps[shareIssue.id] ?? 0}
          votes={board.votesOf(shareIssue.id)}
          topComment={shareComment}
          onClose={() => setShareIssueId(null)}
          onToast={notify}
        />
      ) : null}

      <Toast key={toast?.n ?? 0} message={toast?.text ?? null} onDone={() => setToast(null)} />
    </div>
  );
}
