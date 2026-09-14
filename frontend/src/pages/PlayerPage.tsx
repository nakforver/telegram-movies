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
  const [mediaStatus, setMediaStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.play(params.id)
      .then(async playableSource => {
        if (!playableSource.url) return playableSource;
        const response = await fetch(playableSource.url, { method: 'HEAD' });
        if (response.status === 409) throw new Error(playableSource.reason ?? 'Video processing is unavailable because this title has not been transferred to R2.');
        if (!response.ok) throw new Error('Video source is unavailable. Please try again.');
        return playableSource;
      })
      .then(playableSource => {
        if (cancelled) return;
        setSource(playableSource);
        setMediaStatus(playableSource.url ? 'ready' : 'error');
        setStatus(playableSource.url ? 'Video source ready.' : 'This title cannot be played yet.');
      })
      .catch(mediaError => {
        if (cancelled) return;
        setError(mediaError instanceof Error ? mediaError.message : 'The player failed to load.');
        setMediaStatus('error');
      });
    return () => { cancelled = true; };
  }, [params.id]);
  function saveProgress(progress: number) {
    if (!source) return;
    history.save({ id: source.movieId, title: source.title, titleKm: source.titleKm, type: source.type }, progress);
  }
  if (error) return <><h1 className="page-title">Player</h1><div className="error">{error}</div></>;
  if (!source) return <div className="loading">Loading player…</div>;
  if (!source.playable) return <><h1 className="page-title">{source.title}</h1><div className="status">This title cannot be played yet. {source.reason ?? 'The catalog administrator must attach a valid Telegram chat and message reference.'}</div></>;
  if (mediaStatus !== 'ready') return <><h1 className="page-title">{source.title}</h1><div className="player-status">{status}</div></>;
  return (
    <>
      <h1 className="page-title">{source.title}</h1>
      <video
        className="player" controls playsInline preload="metadata" muted={muted}
        ref={videoRef}
        src={source.url}
        onError={() => {
          setMediaStatus('error');
          setStatus('Video source unavailable. The R2 media source may be missing or expired.');
        }}
        onLoadedMetadata={() => setStatus('Video loaded.')}
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
      <div className="status">{status}<br />Now playing: {source.title}{source.titleKm ? ` • ${source.titleKm}` : ''}{source.type === 'series' ? ` • S${String(source.season ?? 0).padStart(2, '0')} E${String(source.episode ?? 0).padStart(2, '0')}` : ''}</div>
    </>
  );
}
