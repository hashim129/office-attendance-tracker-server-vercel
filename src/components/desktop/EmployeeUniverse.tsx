import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, MessageCircle, Reply, Lock, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { Employee } from '../../types';
import { getSessionToken } from '../../lib/storage';
import { AvatarEditor } from './AvatarEditor';
import { EmployeeAvatar } from '../common/EmployeeIdentity';
import { installSoundUnlock, isSoundOn, playAlertSound, setSoundOn } from '../../crm/sound';

type PublicPerson = { id: string; name: string; role?: string; characterId?: string | null; petId?: string | null; appearance?: Record<string, string> | null };
type ChatMessage = { id: string; body: string; sender: PublicPerson; mentions: PublicPerson[]; private?: boolean; recipientIds?: string[]; replyTo: string | null; createdAt: string };
interface Props {
  chatEnabled?: boolean;
  currentUser: Employee;
  employees: Employee[];
  onProfileSaved: (characterId: string, petId: string, appearance: Record<string, string>) => void;
}
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/**
 * The floating chat button must never sit on top of a form's Save button: it hides while a form / popup is open,
 * while typing on a phone (keyboard up), and on phones while scrolling down (it comes back when scrolling up).
 */
function useLauncherHidden(): boolean {
  const [blocked, setBlocked] = useState(false);
  const [scrollHidden, setScrollHidden] = useState(false);
  useEffect(() => {
    let raf = 0;
    const phone = () => window.matchMedia('(max-width: 639.98px)').matches;
    const check = () => {
      raf = 0;
      const a = document.activeElement as HTMLElement | null;
      const typing = phone() && !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && !a.closest('[data-universe-chat]');
      setBlocked(Boolean(document.querySelector('[data-app-modal], [aria-modal="true"]:not([data-universe-chat])')) || typing);
    };
    const queue = () => { if (!raf) raf = window.requestAnimationFrame(check); };
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', queue);
    document.addEventListener('focusout', () => window.setTimeout(queue, 50));
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      if (!phone()) return;
      const t = (e.target === document ? document.scrollingElement : e.target) as HTMLElement | null;
      if (!t || (t as HTMLElement).closest?.('[data-universe-chat]')) return;
      const y = t.scrollTop || 0;
      const prev = last.get(t) ?? 0;
      if (Math.abs(y - prev) > 12) { setScrollHidden(y > prev && y > 80); last.set(t, y); }
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    check();
    return () => { mo.disconnect(); document.removeEventListener('focusin', queue); document.removeEventListener('scroll', onScroll, { capture: true } as any); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return blocked || scrollHidden;
}

const QUICK_REPLIES = ['On it', 'Done', 'Will check and update', 'Thank you', 'In a meeting, back soon'];

export const EmployeeUniverse: React.FC<Props> = ({ chatEnabled = true, currentUser, employees, onProfileSaved }) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [characterId, setCharacterId] = useState(currentUser.gameCharacterId || '');
  const [petId, setPetId] = useState(currentUser.gamePetId || 'none');
  const [appearance, setAppearance] = useState<Record<string, string>>(currentUser.avatarAppearance || {});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [unread, setUnread] = useState(0);
  const [alertMessage, setAlertMessage] = useState('');
  const [sound, setSound] = useState(isSoundOn());
  const seen = useRef<Set<string> | null>(null);
  const chatOpenRef = useRef(false);
  const polling = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const token = getSessionToken();
  const launcherHidden = useLauncherHidden();
  // @-mention suggestions while typing, e.g. "@zai" -> Zain
  const mentionQuery = (/(?:^|\s)@([^\s@]{0,20})$/.exec(message) || [])[1];
  const mentionSuggestions = mentionQuery === undefined ? [] : employees
    .filter((e) => e.isActive !== false && e.id !== currentUser.id && e.name.toLowerCase().replace(/\s+/g, '').includes(mentionQuery.toLowerCase()))
    .slice(0, 5);
  useEffect(()=>{
    if(!token) return;
    let busy=false;
    const ping=async()=>{
      if(document.hidden || !navigator.onLine || busy) return;
      busy=true;
      try {await fetch('/api/universe',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':token},body:JSON.stringify({action:'presence'}),signal:AbortSignal.timeout(10000)});}
      catch { /* The next visible heartbeat renews presence. */ }
      finally {busy=false;}
    };
    void ping();
    const timer=window.setInterval(ping,20000);
    document.addEventListener('visibilitychange',ping);window.addEventListener('online',ping);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',ping);window.removeEventListener('online',ping);};
  },[token]);
  useEffect(() => { installSoundUnlock(); }, []);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) { setUnread(0); setAlertMessage(''); } }, [chatOpen]);
  useEffect(() => { const clear = () => { if (!document.hidden && chatOpenRef.current) { setUnread(0); setAlertMessage(''); } }; document.addEventListener('visibilitychange', clear); return () => document.removeEventListener('visibilitychange', clear); }, []);

  useEffect(() => {
    if (profileOpen) return;
    setCharacterId(currentUser.gameCharacterId || 'human-1');
    setPetId(currentUser.gamePetId || 'none');
    setAppearance(currentUser.avatarAppearance || {});
  }, [profileOpen, currentUser.id, currentUser.gameCharacterId, currentUser.gamePetId, currentUser.avatarAppearance]);

  const refreshMessages = useCallback(async () => {
    if (!token || !chatEnabled || polling.current) return;
    polling.current = true;
    try {
      const response = await fetch('/api/universe', { headers: { 'x-session-token': token }, cache: 'no-store' });
      if (!response.ok) { setChatError('Employee Universe is unavailable. Please retry shortly.'); return; }
      const data = await response.json();
      if (Array.isArray(data.messages)) {
        const incoming: ChatMessage[] = data.messages;
        if (seen.current) {
          const fresh = incoming.filter((m) => !seen.current!.has(m.id) && m.sender.id !== currentUser.id);
          if (fresh.length) {
            playAlertSound('notice');
            if (!chatOpenRef.current || document.hidden) {
              setUnread((n) => n + fresh.length);
              setAlertMessage(`${fresh.length === 1 ? 'New message' : `${fresh.length} new messages`} in Employee Universe`);
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
                try { new Notification('Employee Universe', { body: 'You have a new chat message.', tag: 'employee-universe' }); } catch { /* optional notification */ }
              }
            }
          }
        }
        seen.current = new Set([...(seen.current || []), ...incoming.map((m) => m.id)].slice(-500));
        setMessages(incoming);
      }
      setChatError('');
    } catch {
      setChatError('Connection paused. Messages will retry automatically.');
    } finally { polling.current = false; }
  }, [token, chatEnabled, currentUser.id]);

  useEffect(() => {
    void refreshMessages();
    const timer = window.setInterval(() => void refreshMessages(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshMessages]);

  useEffect(() => {
    if (chatOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatOpen, messages.length]);

  const unreadMentions = unread;
  const replyPrivately = (item: ChatMessage) => {
    setReplyTo(item);
    setMentionIds(item.private ? [...new Set([item.sender.id, ...(item.recipientIds || item.mentions.map((p) => p.id))])].filter((id) => id !== currentUser.id) : []);
  };

  const saveProfile = async () => {
    
    setSavingProfile(true);
    setProfileError('');
    try {
      const response = await fetch('/api/universe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ action: 'profile', characterId, petId, appearance: { ...appearance, ...(currentUser.avatarAppearance?.photo ? { photo: currentUser.avatarAppearance.photo } : {}) } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your profile.');
      onProfileSaved(characterId, petId, { ...appearance, ...(currentUser.avatarAppearance?.photo ? { photo: currentUser.avatarAppearance.photo } : {}) });
      setProfileOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const sendMessage = async () => {
    const clean = message.trim();
    if (!clean || sending) return;
    setSending(true);
    setChatError('');
    try {
      const response = await fetch('/api/universe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ action: 'message', message: clean, mentionIds, replyTo: replyTo?.id || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Message could not be sent.');
      setMessage('');
      setMentionIds([]);
      setReplyTo(null);
      setMentionPickerOpen(false);
      await refreshMessages();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const addMention = (person: Employee) => {
    setMentionIds((ids) => ids.includes(person.id) ? ids : [...ids, person.id].slice(0, 12));
    setMessage((value) => value + (value && !value.endsWith(' ') ? ' ' : '') + '@' + person.name.replace(/\s+/g, '') + ' ');
    setMentionPickerOpen(false);
  };

  const formatMessage = (item: ChatMessage) => {
    const tokens = item.body.split(/(@[^\s]+)/g);
    return tokens.map((part, index) => part.startsWith('@')
      ? <span key={index} className="rounded-md bg-violet-100 px-1 font-semibold text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">{part}</span>
      : <React.Fragment key={index}>{part}</React.Fragment>);
  };

  // The presence heartbeat above keeps running even when the chat itself is switched off.
  if (!chatEnabled) return null;

  return (
    <>
      {alertMessage && !chatOpen && !launcherHidden && <button className="fixed bottom-20 right-3 sm:bottom-24 sm:right-5 z-[71] max-w-[80vw] truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" onClick={() => setChatOpen(true)} role="status">{alertMessage}</button>}
      <button type="button" onClick={() => setChatOpen((v) => !v)} data-chat-launcher
        className={`fixed bottom-4 right-3 sm:bottom-5 sm:right-5 z-[70] flex items-center justify-center gap-2 rounded-full bg-slate-900 dark:bg-slate-100 dark:text-slate-900 h-12 w-12 sm:h-11 sm:w-auto sm:px-4 text-sm font-semibold text-white shadow-lg transition duration-200 focus:outline-none focus:ring-4 focus:ring-slate-300/60 ${launcherHidden && !chatOpen ? 'pointer-events-none translate-y-24 opacity-0' : ''}`}
        aria-label="Open team chat" aria-hidden={launcherHidden && !chatOpen ? true : undefined} tabIndex={launcherHidden && !chatOpen ? -1 : undefined}>
        <span className="relative"><MessageCircle className="h-5 w-5" />{unreadMentions > 0 && <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadMentions}</span>}</span>
        <span className="hidden sm:inline">Chat</span>
      </button>

      {chatOpen && (
        <section data-universe-chat className="universe-chat fixed inset-x-0 bottom-0 z-[75] flex h-[min(78vh,640px)] flex-col overflow-hidden rounded-t-2xl sm:inset-x-auto sm:bottom-20 sm:right-4 sm:h-[min(620px,calc(100vh-7rem))] sm:w-[380px] sm:rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-slate-700 dark:bg-slate-950" aria-label="Team chat">
          <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 sm:px-4 dark:border-slate-800">
            <div><p className="text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">Team chat</p><p className="text-[11px] text-slate-500">{employees.filter((e) => e.isActive !== false).length} people</p></div>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setSoundOn(!sound); setSound(!sound); if (!sound) playAlertSound(); }} aria-label={sound ? 'Mute chat sound' : 'Turn chat sound on'}>{sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
              <button type="button" onClick={() => setProfileOpen(true)} className="hidden sm:block rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Profile</button>
              <button type="button" onClick={() => setChatOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close chat"><X className="h-4 w-4" /></button>
            </div>
          </header>
          <div className="flex-1 space-y-1.5 overflow-y-auto overscroll-contain bg-slate-50 px-3 py-3 dark:bg-slate-900">
            {messages.length === 0 && <div className="flex h-full min-h-48 flex-col items-center justify-center text-center"><MessageCircle className="h-8 w-8 text-slate-300" /><p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No messages yet</p><p className="mt-1 max-w-56 text-xs text-slate-500">Messages to the team appear here. Type @ to message someone privately.</p></div>}
            {messages.map((item, idx) => {
              const own = item.sender.id === currentUser.id;
              const mentioned = item.mentions.some((person) => person.id === currentUser.id);
              const quoted = item.replyTo ? messages.find((m) => m.id === item.replyTo) : null;
              const sameAsPrev = idx > 0 && messages[idx - 1].sender.id === item.sender.id;
              return <article key={item.id} className={`flex items-end gap-2 ${own ? 'justify-end' : 'justify-start'} ${sameAsPrev ? '' : 'pt-1.5'}`}>
                {!own && <span className={`shrink-0 ${sameAsPrev ? 'invisible' : ''}`}><EmployeeAvatar characterId={item.sender.characterId || undefined} petId={item.sender.petId || undefined} appearance={item.sender.appearance} name={item.sender.name} size="xs" /></span>}
                <div className={`group max-w-[78%] rounded-2xl px-3 py-2 ${own ? 'rounded-br-md bg-blue-600 text-white' : mentioned ? 'rounded-bl-md bg-amber-50 text-slate-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-slate-100 dark:ring-amber-900' : 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'}`}>
                  {!own && !sameAsPrev && <p className="mb-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{item.sender.name}</p>}
                  {quoted && <div className={`mb-1 rounded-md border-l-2 px-2 py-1 text-[11px] ${own ? 'border-white/60 bg-white/10 text-white/85' : 'border-slate-300 bg-slate-50 text-slate-500 dark:bg-slate-900'}`}>{quoted.sender.name}: {quoted.body.slice(0, 90)}</div>}
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">{formatMessage(item)}</p>
                  <div className={`mt-0.5 flex items-center justify-end gap-2 text-[10px] ${own ? 'text-white/70' : 'text-slate-400'}`}>
                    {item.private && <span className="inline-flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" /> Private{item.mentions.length ? ` · ${item.mentions.map((p) => p.name.split(' ')[0]).join(', ')}` : ''}</span>}
                    {!own && <button type="button" onClick={() => replyPrivately(item)} className="inline-flex items-center gap-0.5 hover:text-blue-600" aria-label={`Reply to ${item.sender.name}`}><Reply className="h-3 w-3" /> Reply</button>}
                    <span>{timeLabel(item.createdAt)}</span>
                  </div>
                </div>
              </article>;
            })}
            <div ref={bottomRef} />
          </div>
          {chatError && <p className="px-3 py-1 text-[11px] text-rose-600">{chatError}</p>}
          {replyTo && <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900"><span className="truncate">Replying to <b>{replyTo.sender.name}</b>: {replyTo.body.slice(0, 60)}</span><button onClick={() => setReplyTo(null)} className="p-1" aria-label="Cancel reply"><X className="h-3 w-3" /></button></div>}
          {mentionPickerOpen && <div className="max-h-40 overflow-y-auto border-t border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-950">{employees.filter((e) => e.isActive !== false && e.id !== currentUser.id).map((person) => <button key={person.id} onClick={() => addMention(person)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"><EmployeeAvatar characterId={person.gameCharacterId} petId={person.gamePetId} appearance={person.avatarAppearance} name={person.name} size="xs" /><span>{person.name}</span></button>)}</div>}
          <footer className="border-t border-slate-200 bg-white p-2 sm:p-2.5 dark:border-slate-800 dark:bg-slate-950" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
            {mentionSuggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1" data-mention-suggestions>
                {mentionSuggestions.map((person) => (
                  <button key={person.id} type="button" className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                    onClick={() => { setMentionIds((ids) => ids.includes(person.id) ? ids : [...ids, person.id].slice(0, 12)); setMessage((v) => v.replace(/@([^\s@]{0,20})$/, '@' + person.name.replace(/\s+/g, '') + ' ')); }}>
                    @{person.name}
                  </button>
                ))}
              </div>
            )}
            {!message.trim() && !replyTo && (
              <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar" data-quick-replies>
                {QUICK_REPLIES.map((q) => <button key={q} type="button" onClick={() => setMessage(q)} className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">{q}</button>)}
              </div>
            )}
            {mentionIds.length > 0 && <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]"><span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300"><Lock className="h-3 w-3" /> Private to</span>{mentionIds.map((id) => <button key={id} type="button" className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-800 dark:bg-slate-800 dark:text-slate-100" onClick={() => setMentionIds((ids) => ids.filter((x) => x !== id))}>{employees.find((e) => e.id === id)?.name || 'Recipient'} ×</button>)}</div>}
            <div className="flex items-end gap-2"><button type="button" onClick={() => setMentionPickerOpen((v) => !v)} className="rounded-full p-2.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Message someone privately"><AtSign className="h-4 w-4" /></button><textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} rows={1} maxLength={1500} placeholder={mentionIds.length ? 'Private message' : 'Message'} className="max-h-24 min-h-10 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /><button type="button" onClick={() => void sendMessage()} disabled={!message.trim() || sending} className="rounded-full bg-blue-600 p-2.5 text-white transition disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message"><Send className="h-4 w-4" /></button></div>
          </footer>
        </section>
      )}

      {profileOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Design your Employee Universe avatar">
          <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-white/60 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
            <div className="flex items-center justify-between bg-gradient-to-r from-violet-700 via-fuchsia-600 to-blue-600 px-6 py-4 text-white"><div className="flex items-center gap-3"><Sparkles className="h-6 w-6" /><div><p className="text-lg font-black">My character</p><p className="text-xs text-white/80">Your avatar travels with your name around the workspace.</p></div></div><button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg p-2 hover:bg-white/20" aria-label="Close"><X className="h-4 w-4" /></button></div>
            <div className="p-3 sm:p-5">
              <AvatarEditor id={characterId || 'human-1'} pet={petId} value={appearance} onChange={setAppearance} onId={setCharacterId} onPet={setPetId} />
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {profileError && <p className="mr-auto text-xs font-medium text-rose-600">{profileError}</p>}
                <button type="button" onClick={() => setProfileOpen(false)} className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
                <button type="button" onClick={() => void saveProfile()} disabled={savingProfile} className="rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-violet-600/20 disabled:opacity-40">{savingProfile ? 'Saving…' : 'Save my character'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
