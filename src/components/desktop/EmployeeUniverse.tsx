import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, MessageCircle, Reply, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
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
      {alertMessage && !chatOpen && <button className="fixed bottom-24 right-5 z-[71] rounded-xl bg-violet-700 px-4 py-3 text-white text-xs shadow-xl" onClick={() => setChatOpen(true)} role="status">🔔 {alertMessage}</button>}
      <button type="button" onClick={() => setChatOpen((v) => !v)} className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-blue-600 px-4 py-3 text-sm font-bold text-white shadow-xl shadow-violet-900/25 transition hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-fuchsia-300/60" aria-label="Open Employee Universe chat">
        <span className="relative"><MessageCircle className="h-5 w-5" />{unreadMentions > 0 && <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-300 px-1 text-[9px] font-black text-slate-900">{unreadMentions}</span>}</span>
        <span className="hidden sm:inline">Employee Universe 2.0</span>
        <EmployeeAvatar characterId={currentUser.gameCharacterId} petId={currentUser.gamePetId} appearance={currentUser.avatarAppearance} name={currentUser.name} size="xs" />
      </button>

      {chatOpen && (
        <section className="fixed bottom-20 right-3 z-[70] flex h-[min(760px,calc(100vh-7rem))] w-[min(820px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-2xl shadow-slate-900/25 dark:border-slate-700 dark:bg-slate-950" aria-label="Employee Universe 2.0 conversation">
          <header className="flex items-center justify-between bg-gradient-to-r from-violet-700 via-fuchsia-600 to-blue-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5"><div className="rounded-xl bg-white/15 p-2"><Sparkles className="h-5 w-5" /></div><div><p className="text-sm font-extrabold">Employee Universe 2.0</p><p className="text-[10px] text-white/75">A friendly space for the whole crew</p></div></div>
            <div className="flex items-center gap-1"><button type="button" onClick={() => setProfileOpen(true)} className="rounded-lg bg-white/15 px-2 py-1.5 text-[10px] font-bold hover:bg-white/25">My character</button><button type="button" onClick={() => setChatOpen(false)} className="rounded-lg p-2 hover:bg-white/20" aria-label="Close chat"><X className="h-4 w-4" /></button></div>
          </header>
          <div className="border-b border-violet-100 bg-violet-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center justify-between"><div><h2 className="text-sm font-black text-violet-800 dark:text-violet-200">Meet your crew</h2><p className="text-[10px] text-slate-500">Explore your colleagues' characters and send them a mention.</p></div><button className="text-xs font-bold text-violet-700 dark:text-violet-300" onClick={() => setProfileOpen(true)}>Customize profile</button></div><div className="mt-3 flex gap-3 overflow-x-auto pb-2">{employees.filter((e) => e.isActive !== false).map((e) => <button key={e.id} disabled={e.id === currentUser.id} type="button" onClick={() => addMention(e)} className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl p-2 hover:bg-violet-100 dark:hover:bg-slate-800"><EmployeeAvatar characterId={e.gameCharacterId} petId={e.gamePetId} appearance={e.avatarAppearance} name={e.name} size="lg"/><span className="w-full truncate text-center text-[10px] font-bold">{e.name}</span>{e.avatarAppearance?.status && e.avatarAppearance.status !== 'None' && <span className="w-full truncate text-center text-[9px] text-violet-600">{e.avatarAppearance.status}</span>}</button>)}</div></div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-violet-50/70 to-white p-3 dark:from-slate-900 dark:to-slate-950">
            {messages.length === 0 && <div className="flex h-full min-h-48 flex-col items-center justify-center text-center"><span className="text-4xl">🚀</span><p className="mt-2 text-sm font-bold text-slate-800 dark:text-white">The lounge is all yours!</p><p className="mt-1 max-w-56 text-xs text-slate-500">Say hello, share an update or mention a teammate.</p></div>}
            {messages.map((item) => {
              const own = item.sender.id === currentUser.id;
              const mentioned = item.mentions.some((person) => person.id === currentUser.id);
              const quoted = item.replyTo ? messages.find((m) => m.id === item.replyTo) : null;
              return <article key={item.id} className={`rounded-2xl border p-3 shadow-sm ${mentioned ? 'border-fuchsia-300 bg-fuchsia-50/80 dark:border-fuchsia-800 dark:bg-fuchsia-950/25' : 'border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900'} ${own ? 'ml-5' : 'mr-3'}`}>
                <div className="mb-1.5 flex items-center gap-2"><EmployeeAvatar characterId={item.sender.characterId || undefined} petId={item.sender.petId || undefined} appearance={item.sender.appearance} name={item.sender.name} size="sm" /><span className="min-w-0 flex-1 truncate text-[11px] font-extrabold text-slate-800 dark:text-slate-100">{item.sender.name}</span><span className="text-[9px] text-slate-400">{timeLabel(item.createdAt)}</span></div>
                {quoted && <div className="mb-2 rounded-lg border-l-2 border-violet-400 bg-violet-50 px-2 py-1 text-[10px] text-slate-500 dark:bg-violet-950/30">↪ {quoted.sender.name}: {quoted.body.slice(0, 90)}</div>}
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 dark:text-slate-200">{formatMessage(item)}</p>
                {item.mentions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.mentions.map((person) => <span key={person.id} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-[9px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"><EmployeeAvatar characterId={person.characterId || undefined} petId={person.petId || undefined} name={person.name} size="xs" />{person.name}</span>)}</div>}
                <div className="mt-2 flex justify-between items-center"><span className="text-[10px] font-bold text-violet-600">{item.private ? '🔒 Private' : '🌐 Everyone'}</span><button type="button" onClick={() => replyPrivately(item)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-violet-600 dark:hover:bg-slate-800"><Reply className="h-3 w-3" /> Reply</button></div>
              </article>;
            })}
            <div ref={bottomRef} />
          </div>
          {chatError && <p className="px-3 py-1 text-[10px] text-rose-600">{chatError}</p>}
          {replyTo && <div className="flex items-center justify-between border-t border-slate-100 bg-violet-50 px-3 py-2 text-[10px] dark:border-slate-800 dark:bg-violet-950/20"><span className="truncate">Replying to <b>{replyTo.sender.name}</b>: {replyTo.body.slice(0, 60)}</span><button onClick={() => setReplyTo(null)} className="p-1" aria-label="Cancel reply"><X className="h-3 w-3" /></button></div>}
          {mentionPickerOpen && <div className="max-h-36 overflow-y-auto border-t border-slate-100 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"><p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Mention a teammate</p>{employees.filter((e) => e.isActive !== false && e.id !== currentUser.id).map((person) => <button key={person.id} onClick={() => addMention(person)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-violet-50 dark:hover:bg-slate-800"><EmployeeAvatar characterId={person.gameCharacterId} petId={person.gamePetId} appearance={person.avatarAppearance} name={person.name} size="xs" /><span>{person.name}</span></button>)}</div>}
          <footer className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><b className="text-violet-700 dark:text-violet-300">{mentionIds.length ? '🔒 Private message' : '🌐 Everyone can see this'}</b>{mentionIds.map((id) => <button key={id} type="button" className="rounded-full bg-violet-100 px-2 py-1 text-violet-800" onClick={() => setMentionIds((ids) => ids.filter((x) => x !== id))}>{employees.find((e) => e.id === id)?.name || 'Recipient'} ×</button>)}<button type="button" className="ml-auto flex items-center gap-1" onClick={() => { setSoundOn(!sound); setSound(!sound); if (!sound) playAlertSound(); }}>{sound ? <Volume2 size={14}/> : <VolumeX size={14}/>} Sound</button>{typeof Notification !== 'undefined' && Notification.permission === 'default' && <button type="button" className="flex items-center gap-1" onClick={() => void Notification.requestPermission()}><Bell size={14}/> Desktop alerts</button>}</div>
            <div className="mb-2 flex gap-1 overflow-x-auto">{['👋','😂','🔥','🎉','👍','🙏','☕','✈️','💯','❤️'].map((emoji) => <button key={emoji} type="button" onClick={() => setMessage((v) => (v + emoji).slice(0, 1500))} className="rounded-lg px-1.5 py-0.5 text-base transition hover:scale-125 hover:bg-violet-50 dark:hover:bg-slate-800" aria-label={'Add ' + emoji}>{emoji}</button>)}</div>
            <div className="flex items-end gap-2"><button type="button" onClick={() => setMentionPickerOpen((v) => !v)} className="rounded-xl border border-violet-200 p-2.5 text-violet-600 hover:bg-violet-50 dark:border-violet-900 dark:hover:bg-violet-950" aria-label="Mention someone"><AtSign className="h-4 w-4" /></button><textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} rows={2} maxLength={1500} placeholder="Message the team… (Enter to send)" className="max-h-24 min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /><button type="button" onClick={() => void sendMessage()} disabled={!message.trim() || sending} className="rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 p-3 text-white shadow-md transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message"><Send className="h-4 w-4" /></button></div>
            <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400"><span>{mentionIds.length} teammates mentioned</span><span>{message.length}/1500</span></div>
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
