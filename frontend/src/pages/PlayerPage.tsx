import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { PlaySource } from '../types';
import { history } from '../services/storage';
import { useParams } from '../router';

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const [source, setSource] = useState<PlaySource>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading player…');
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { api.play(params.id).then(setSource).catch(setError); }, [params.id]);
  function saveProgress(progress: number) {
    if (!source) return;
    history.save({ id: source.movieId, title: source.title, titleKm: source.titleKm, type: source.type }, progress);
  }
  if (error) return <><h1 className="page-title">Player</h1><div className="error">{error}</div></>;
  if (!source) return <div className="loading">Loading player…</div>;
  if (!source.playable) return <><h1 className="page-title">{source.title}</h1><div className="status">This title cannot be played yet. {source.reason ?? 'The catalog administrator must attach a valid Telegram chat and message reference.'}</div></>;
  return (
    <>
      <h1 className="page-title">{source.title}</h1>
      <video
        className="player" controls playsInline preload="metadata" muted={muted}
        ref={videoRef}
        onError={() => setStatus('Video source unavailable.')}
        onWaiting={() => setStatus('Buffering…')} onPlaying={() => setStatus('Playing')} onPause={() => setStatus('Paused')}
        onTimeUpdate={event => saveProgress(Math.min(100, (event.currentTarget.currentTime / (event.currentTarget.duration || 1)) * 100))}
      >
        Your browser does not support HTML5 video.
      </video>
      <div className="player-controls">
        <button onClick={() => videoRef.current?.play()}>▶ Play</button>
        <button onClick={() => videoRef.current?.pause()}>⏸ Pause</button>
        <button onClick={() => { setMuted(!muted); videoRef.current!.muted = !muted; }}>{muted ? '🔇 Unmute' : '🔊 Mute'}</button>
        <button onClick={() => { const element = videoRef.current; if (element?.requestFullscreen) void element.requestFullscreen(); }}>⛶ Fullscreen</button>
      </div>
      <div className="status">{status}<br />Playback metadata: Telegram chat {source.telegramChatId}, message {source.telegramMessageId}.</div>
    </>
  );
}
