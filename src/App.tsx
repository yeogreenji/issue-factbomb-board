import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue, View } from './types';
import { useBoard, type BoardApi } from './hooks/useBoard';
import { SiteHeader, type NavKey } from './components/SiteHeader';
import { ConnectionStrip } from './components/ConnectionStrip';
import { Ticker } from './components/Ticker';
import { FeedPage } from './components/FeedPage';
import { RankingPage } from './components/RankingPage';
import { IssueDetail } from './components/IssueDetail';
import { EditorStudio } from './components/EditorStudio';
import { Footer } from './components/Footer';
import { ShareModal } from './components/ShareModal';
import { ApiKeyModal } from './components/ApiKeyModal';
import { Toast } from './components/Toast';
import { bestEntries } from './lib/selectors';

/** 공유 링크(?issue=…)와 해시 라우트(#/issue/…) 둘 다 받습니다. */
function parseLocation(): View {
  const sharedId = new URLSearchParams(window.location.search).get('issue');
  if (sharedId) return { name: 'issue', id: sharedId };

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
  const [view, setView] = useState<View>(() => parseLocation());
  const [shareIssueId, setShareIssueId] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  const notify = useCallback((text: string) => {
    setToast((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setView(parseLocation());
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** 공유 링크로 들어온 상태(?issue=)에서 이동하면 파라미터를 먼저 지워 해시 라우트를 살립니다. */
  const goToHash = useCallback((hash: string) => {
    if (window.location.search.length > 0) {
      window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
      setView(parseLocation());
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    window.location.hash = hash;
  }, []);

  const navigate = useCallback((key: NavKey) => goToHash(hashFor(key)), [goToHash]);

  const openIssue = useCallback((id: string) => goToHash(`#/issue/${id}`), [goToHash]);

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
    async (input: Parameters<BoardApi['publish']>[0]) => {
      const { issue, synced } = await board.publish(input);
      notify(
        synced
          ? '발행 완료 — 공용 보드에 올렸습니다.'
          : board.syncEnabled
            ? '발행했습니다. 서버에 닿지 않아 이 기기에 보관했고, 연결되면 자동으로 다시 올립니다.'
            : '발행 완료 — 이 브라우저에 저장했습니다. (로컬 체험 모드)',
      );
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
      notify(board.syncEnabled ? '팩폭을 등록했습니다. 좋아요로 순위가 올라갑니다.' : '팩폭을 남겼습니다. 이 브라우저에 저장됩니다.');
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
      <ConnectionStrip
        status={board.status}
        mode={board.mode}
        store={board.store}
        syncEnabled={board.syncEnabled}
        pending={board.pending}
        notice={board.notice}
        ai={board.ai}
        onOpenKey={() => setKeyModal(true)}
        onRefresh={() => {
          board.refresh();
          notify('공용 보드를 새로 읽었습니다.');
        }}
      />
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
          <EditorStudio
            onPublish={handlePublish}
            onToast={notify}
            ai={board.ai}
            onOpenKey={() => setKeyModal(true)}
            syncEnabled={board.syncEnabled}
          />
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
          ) : board.status === 'connecting' ? (
            <div className="mx-auto w-full max-w-[1240px] px-4 py-24 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-heat" />
              <p className="serif mt-4 text-[16px] font-bold text-ink">공유된 이슈를 불러오는 중…</p>
              <p className="mt-1.5 text-[12px] text-muted">공용 보드에서 이슈를 찾고 있습니다.</p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1240px] px-4 py-24 text-center">
              <p className="serif text-[20px] font-bold text-ink">이슈를 찾을 수 없습니다.</p>
              <p className="mt-2 text-[12.5px] text-muted">
                주소가 바뀌었거나 삭제된 이슈입니다. {board.syncEnabled ? '공용 보드에도 같은 주소의 이슈가 없습니다.' : '이 브라우저 기록에도 없습니다.'}
              </p>
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
        mode={board.syncEnabled ? board.mode : 'local'}
        onReset={() => {
          const ok = window.confirm(
            board.syncEnabled
              ? '이 기기의 기록(내 투표·내 팩폭·발행 표시)을 지웁니다. 공용 보드에 이미 올라간 글은 서버에 남습니다. 계속할까요?'
              : '투표·팩폭·발행한 이슈를 모두 지우고 데모 데이터로 돌아갑니다. 계속할까요?',
          );
          if (!ok) return;
          board.reset();
          notify('이 기기의 보드 기록을 초기화했습니다.');
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

      {keyModal ? (
        <ApiKeyModal
          ai={board.ai}
          onSave={(key) => {
            board.setPersonalAiKey(key);
            notify(key.trim() ? 'AI 키를 이 브라우저에 저장했습니다.' : 'AI 키를 지웠습니다.');
          }}
          onClose={() => setKeyModal(false)}
        />
      ) : null}

      <Toast key={toast?.n ?? 0} message={toast?.text ?? null} onDone={() => setToast(null)} />
    </div>
  );
}
