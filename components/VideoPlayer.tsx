
import React, { useState, useEffect, useRef } from 'react';
import { Story, RolePlayLine } from '../types';
import { Play, Pause, Home, Loader, Video, Download, StopCircle, RotateCcw, Disc } from 'lucide-react';
import * as GeminiService from '../services/geminiService';

interface VideoPlayerProps {
  story: Story;
  script: RolePlayLine[];
  onReset: () => void;
}

const AVAILABLE_VOICES = ['Puck', 'Kore', 'Fenrir', 'Charon', 'Zephyr'] as const;

// Palette for character names
const CHARACTER_COLORS = [
  '#fbbf24', // Amber-400
  '#22d3ee', // Cyan-400
  '#f472b6', // Pink-400
  '#a3e635', // Lime-400
  '#c084fc', // Violet-400
  '#fb923c', // Orange-400
  '#2dd4bf', // Teal-400
  '#f87171'  // Red-400
];

const getCharacterColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % CHARACTER_COLORS.length);
    return CHARACTER_COLORS[index];
};

const VideoPlayer: React.FC<VideoPlayerProps> = ({ story, script, onReset }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false); // Global Loading (Full Preload)
  const [isBuffering, setIsBuffering] = useState(false); // Playback Buffering (Transient)
  
  // -1 represents the Intro sequence
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  
  // Store recorded video for download
  const [recordedVideo, setRecordedVideo] = useState<{ url: string, filename: string } | null>(null);
  const [recordingInterrupted, setRecordingInterrupted] = useState(false);
  
  // Cache for TTS audio to avoid re-generating
  const [ttsCache, setTtsCache] = useState<Record<string, string>>({});
  
  // Refs for State Access inside Animation Loop
  const isPlayingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isRecordingCancelledRef = useRef(false); 
  const currentLineIndexRef = useRef(-1); 
  const characterVoicesRef = useRef<Record<string, typeof AVAILABLE_VOICES[number]>>({});
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const startTimeRef = useRef<number>(0);
  const lastImageUrlRef = useRef<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Web Audio API Refs for robust recording
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Sync state to refs
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  
  useEffect(() => { 
      if (currentLineIndexRef.current !== currentLineIndex) {
          currentLineIndexRef.current = currentLineIndex; 
      }
  }, [currentLineIndex]);

  // Initialize character voices
  useEffect(() => {
    const chars = Array.from(new Set(script.map(l => l.character)));
    chars.forEach((char, idx) => {
      if (!characterVoicesRef.current[char]) {
        characterVoicesRef.current[char] = AVAILABLE_VOICES[idx % AVAILABLE_VOICES.length];
      }
    });
  }, [script]);

  // Initialize on mount and interaction
  useEffect(() => {
    // Attempt to initialize AudioContext early on interaction
    const handleInteract = () => {
        if (!audioContextRef.current) {
            initAudioSystem();
        } else if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };
    window.addEventListener('click', handleInteract);
    window.addEventListener('touchstart', handleInteract);
    
    return () => {
        window.removeEventListener('click', handleInteract);
        window.removeEventListener('touchstart', handleInteract);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
        if (recordedVideo) URL.revokeObjectURL(recordedVideo.url);
    };
  }, []);

  // Ensure Intro is drawn when reset
  useEffect(() => {
      if (!isPlaying && !isRecording && currentLineIndex === -1 && canvasRef.current) {
           const ctx = canvasRef.current.getContext('2d');
           if (ctx) drawIntro(ctx, canvasRef.current.width, canvasRef.current.height);
      }
  }, [isPlaying, isRecording, currentLineIndex, story]);

  // Robust Audio Initialization
  const initAudioSystem = () => {
    try {
        if (!audioContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            
            // Create destination for recording
            const dest = ctx.createMediaStreamDestination();
            audioDestRef.current = dest;
        }

        const ctx = audioContextRef.current;
        if (!ctx) return;

        // Connect audio element to context ONLY ONCE
        if (audioRef.current && !sourceNodeRef.current) {
            const source = ctx.createMediaElementSource(audioRef.current);
            sourceNodeRef.current = source;
            
            // Connect to speakers (monitor)
            source.connect(ctx.destination);
            // Connect to recording stream
            if (audioDestRef.current) {
                source.connect(audioDestRef.current);
            }
        }

        if (ctx.state === 'suspended') {
            ctx.resume();
        }
    } catch (e) {
        console.warn("Audio init warning:", e);
    }
  };

  /**
   * Helper: Loads a single image if not already loaded.
   */
  const loadImage = async (imageUrl: string) => {
    if (!imageUrl || imagesRef.current[imageUrl]) return;
    return new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageUrl;
        img.onload = () => {
            imagesRef.current[imageUrl] = img;
            resolve();
        };
        img.onerror = () => resolve(); 
    });
  };

  /**
   * Helper: Generates TTS for a single line if not cached.
   * Returns the URL (newly generated or cached).
   */
  const loadAudioForLine = async (line: RolePlayLine): Promise<string | null> => {
      if (line.audioUrl) return line.audioUrl;
      if (ttsCache[line.id]) return ttsCache[line.id];

      try {
          const voice = characterVoicesRef.current[line.character] || 'Puck';
          const url = await GeminiService.generateSpeech(line.text, voice);
          if (url) {
              // Update cache state so UI updates if needed
              setTtsCache(prev => ({ ...prev, [line.id]: url }));
              return url;
          }
      } catch (e) {
          console.error(`Failed to generate audio for line ${line.id}`, e);
      }
      return null;
  };

  /**
   * Progressive Buffering:
   * 1. Checks if current line assets are ready. If not, waits.
   * 2. Triggers background load for next N lines.
   */
  const ensureAssetsForLine = async (index: number) => {
      if (index < 0 || index >= script.length) return;
      const line = script[index];
      const pageIdx = line.pageIndex ?? 0;
      const imageUrl = story.pages[pageIdx]?.imageUrl;

      // Check current
      const hasImage = !imageUrl || imagesRef.current[imageUrl];
      const hasAudio = line.audioUrl || ttsCache[line.id];

      if (!hasImage || !hasAudio) {
          setIsBuffering(true);
          await Promise.all([
             imageUrl ? loadImage(imageUrl) : Promise.resolve(),
             loadAudioForLine(line)
          ]);
          setIsBuffering(false);
      }

      // Background Preload (Next 3 lines)
      const PRELOAD_WINDOW = 3;
      for (let i = 1; i <= PRELOAD_WINDOW; i++) {
          const nextIdx = index + i;
          if (nextIdx < script.length) {
              const nextLine = script[nextIdx];
              const nextPgIdx = nextLine.pageIndex ?? 0;
              const nextImg = story.pages[nextPgIdx]?.imageUrl;
              
              // We don't await these; fire and forget
              if (nextImg) loadImage(nextImg);
              loadAudioForLine(nextLine);
          }
      }
  };

  /**
   * Full Preload: Used strictly for Recording to ensure no hitches.
   */
  const preloadAllAssets = async () => {
      setIsPreparing(true);
      
      // 1. Preload All Images
      const imagePromises = story.pages.map(page => {
          if (page.imageUrl) return loadImage(page.imageUrl);
          return Promise.resolve();
      });

      // 2. Preload All Audio
      const audioPromises = script.map(line => loadAudioForLine(line));

      await Promise.all([...imagePromises, ...audioPromises]);
      setIsPreparing(false);
  };

  const advanceToNextLine = () => {
      if (isPlayingRef.current || isRecordingRef.current) {
          const nextIdx = currentLineIndexRef.current + 1;
          currentLineIndexRef.current = nextIdx;
          setCurrentLineIndex(nextIdx);
          
          playNext();
      }
  };

  const playNext = async () => {
      const idx = currentLineIndexRef.current;
      
      if (!isPlayingRef.current && !isRecordingRef.current) return;

      // End
      if (idx >= script.length) {
          stopPlayback();
          return;
      }

      // Intro
      if (idx === -1) {
          // While Intro plays (3s), assume we can buffer start of story
          if (!isRecordingRef.current) {
              // Preload start of story during intro
              ensureAssetsForLine(0);
          }
          setTimeout(() => { advanceToNextLine(); }, 3000);
          return;
      }

      // Standard Line Playback
      const line = script[idx];
      
      // For Playback Mode: Progressive Buffering
      if (!isRecordingRef.current) {
          await ensureAssetsForLine(idx);
          // Re-check playing state after await
          if (!isPlayingRef.current) return;
      }

      // Get Audio
      let audioUrl = line.audioUrl || ttsCache[line.id];
      if (!audioUrl) {
          // Safety fallback if buffering failed
          console.warn("Audio missing after buffer, skipping...");
          setTimeout(advanceToNextLine, 1000);
          return;
      }
      
      if (!audioRef.current) return;
      
      // Ken Burns Setup
      const pageIdx = line.pageIndex ?? 0;
      const imageUrl = story.pages[pageIdx]?.imageUrl;
      if (imageUrl !== lastImageUrlRef.current || idx === 0) {
          startTimeRef.current = Date.now();
          lastImageUrlRef.current = imageUrl;
      }

      audioRef.current.src = audioUrl;
      audioRef.current.volume = 1.0;
      audioRef.current.muted = false;

      try {
          if (audioContextRef.current?.state === 'suspended') {
              await audioContextRef.current.resume();
          }
          await audioRef.current.play();
      } catch (e) {
          console.error("Playback failed:", e);
          setTimeout(advanceToNextLine, 2000);
      }
  };

  const handleAudioEnded = () => {
      // Small delay between lines
      setTimeout(advanceToNextLine, 300);
  };

  // --- Animation Loop ---
  const renderFrame = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const idx = currentLineIndexRef.current;
      const width = canvas.width;
      const height = canvas.height;

      // Draw Logic
      if (idx === -1) {
          drawIntro(ctx, width, height);
      } else if (idx < script.length && idx >= 0) {
          const line = script[idx];
          const pageIdx = line.pageIndex ?? 0;
          const imageUrl = story.pages[pageIdx]?.imageUrl;
          
          if (imageUrl && imagesRef.current[imageUrl]) {
              const img = imagesRef.current[imageUrl];
              
              // Background
              ctx.save();
              ctx.filter = 'blur(15px) brightness(0.6)';
              const scaleBg = Math.max(width / img.width, height / img.height);
              const xBg = (width - img.width * scaleBg) / 2;
              const yBg = (height - img.height * scaleBg) / 2;
              ctx.drawImage(img, xBg, yBg, img.width * scaleBg, img.height * scaleBg);
              ctx.restore();

              // Foreground (Ken Burns)
              const elapsed = Date.now() - startTimeRef.current;
              const duration = 15000; 
              const zoom = 1.0 + (elapsed / duration) * 0.1; 

              const scaleFg = Math.min(width / img.width, height / img.height) * 0.85 * zoom;
              const wFg = img.width * scaleFg;
              const hFg = img.height * scaleFg;
              const xFg = (width - wFg) / 2;
              const yFg = (height - hFg) / 2;

              ctx.shadowColor = 'rgba(0,0,0,0.5)';
              ctx.shadowBlur = 20;
              ctx.drawImage(img, xFg, yFg, wFg, hFg);
              ctx.shadowBlur = 0;

              // Subtitles
              drawSubtitles(ctx, line, width, height);
          }
      }

      if (isPlayingRef.current || isRecordingRef.current) {
          animationFrameRef.current = requestAnimationFrame(renderFrame);
      }
  };

  const drawIntro = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#4f46e5'); 
      grad.addColorStop(1, '#db2777'); 
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.arc(100, 100, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(width - 100, height - 100, 200, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 72px "Fredoka", sans-serif';
      ctx.fillText(story.title, width / 2, height / 3);
      
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      ctx.fillStyle = '#fbbf24'; 
      ctx.font = 'bold 32px "Fredoka", sans-serif';
      ctx.fillText("Starring:", width / 2, height / 2 + 20);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px "Fredoka", sans-serif';
      ctx.fillText(story.characters.join(' & '), width / 2, height / 2 + 60);
      
      ctx.fillStyle = '#a3e635'; 
      ctx.font = 'bold 32px "Fredoka", sans-serif';
      ctx.fillText("Words to Know:", width / 2, height / 2 + 120);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px "Fredoka", sans-serif';
      const vocabText = story.vocabulary.slice(0, 5).join(', ') + (story.vocabulary.length > 5 ? '...' : '');
      ctx.fillText(vocabText, width / 2, height / 2 + 160);
  };

  const drawSubtitles = (ctx: CanvasRenderingContext2D, line: RolePlayLine, width: number, height: number) => {
      const padding = 20;
      const boxHeight = 120;
      const boxY = height - boxHeight - 40;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(40, boxY, width - 80, boxHeight, 20);
      } else {
        ctx.fillRect(40, boxY, width - 80, boxHeight);
      }
      ctx.fill();

      ctx.font = 'bold 28px "Fredoka", sans-serif';
      ctx.fillStyle = getCharacterColor(line.character);
      ctx.textAlign = 'left';
      ctx.fillText(line.character, 60, boxY + 40);

      ctx.font = '32px "Fredoka", sans-serif';
      ctx.textAlign = 'left';
      
      const maxWidth = width - 120;
      const words = line.text.split(' ');
      let lineText = '';
      let y = boxY + 80;
      const lineHeight = 40;
      
      const linesToDraw: {text: string, x: number, y: number}[] = [];
      
      for(let n = 0; n < words.length; n++) {
        const testLine = lineText + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            linesToDraw.push({ text: lineText, x: 60, y: y });
            lineText = words[n] + ' ';
            y += lineHeight;
        } else {
            lineText = testLine;
        }
      }
      linesToDraw.push({ text: lineText, x: 60, y: y });

      linesToDraw.forEach(l => {
          let currentX = l.x;
          const lineWords = l.text.split(' ');
          lineWords.forEach(word => {
             const cleanWord = word.replace(/[^a-zA-Z]/g, '');
             const isVocab = story.vocabulary.some(v => v.toLowerCase() === cleanWord.toLowerCase());
             
             ctx.fillStyle = isVocab ? '#fbbf24' : '#ffffff';
             ctx.font = isVocab ? 'bold 32px "Fredoka", sans-serif' : '32px "Fredoka", sans-serif';
             
             ctx.fillText(word + ' ', currentX, l.y);
             currentX += ctx.measureText(word + ' ').width;
          });
      });
  };

  const togglePlay = async () => {
      if (isPlaying) {
          stopPlayback();
      } else {
          initAudioSystem();
          // NO full preload here. Just start!
          
          setIsPlaying(true);
          isPlayingRef.current = true;
          
          // Reset logic if we are at end or start
          if (currentLineIndexRef.current === -1 || currentLineIndexRef.current >= script.length) {
              currentLineIndexRef.current = -1;
              setCurrentLineIndex(-1);
              startTimeRef.current = Date.now();
          }
          
          if (!animationFrameRef.current) renderFrame();
          playNext();
      }
  };

  const stopPlayback = () => {
      setIsPlaying(false);
      setIsRecording(false);
      setIsPreparing(false);
      setIsBuffering(false);
      if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
      }
      if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
      }
  };

  const handleCancelRecording = () => {
      isRecordingCancelledRef.current = true;
      setRecordingInterrupted(true);
      stopPlayback();
      setCurrentLineIndex(-1);
      currentLineIndexRef.current = -1;
      setRecordedVideo(null); 
  };

  // Called to START recording (Phase 1)
  const handleStartRecording = async () => {
      stopPlayback();
      setRecordingInterrupted(false);
      isRecordingCancelledRef.current = false;
      setRecordedVideo(null); 
      
      initAudioSystem();
      if (!audioContextRef.current) return alert("Audio init failed. Tap page and try again.");
      
      // FOR RECORDING: We still use Full Preload to ensure perfect output file
      await preloadAllAssets();

      setCurrentLineIndex(-1);
      currentLineIndexRef.current = -1;
      lastImageUrlRef.current = null;
      startTimeRef.current = Date.now();
      
      setIsRecording(true);
      isRecordingRef.current = true; 
      recordedChunksRef.current = [];

      const canvas = canvasRef.current;
      if (!canvas || !audioDestRef.current) return;
      
      const canvasStream = canvas.captureStream(30); 
      const audioStream = audioDestRef.current.stream;
      const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
      ]);

      const mimeTypes = [
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
          'video/mp4', 
          'video/webm;codecs=vp9,opus', 
          'video/webm',
      ];
      let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

      if (!selectedMimeType) return alert("Browser does not support video recording.");

      try {
        const recorder = new MediaRecorder(combinedStream, { mimeType: selectedMimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
            if (isRecordingCancelledRef.current) return;

            const blob = new Blob(recordedChunksRef.current, { type: selectedMimeType });
            const url = URL.createObjectURL(blob);
            const ext = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
            const filename = `${story.title.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
            
            setRecordedVideo({ url, filename });
            
            stopPlayback();
            setCurrentLineIndex(-1);
        };

        recorder.start();
        renderFrame(); 
        playNext();    

      } catch (e) {
          console.error("Recorder error:", e);
          alert("Recording failed to start.");
          setIsRecording(false);
      }
  };

  const handleSaveVideo = () => {
      if (!recordedVideo) return;
      const a = document.createElement('a');
      a.href = recordedVideo.url;
      a.download = recordedVideo.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const isFinished = !isPlaying && !isRecording && currentLineIndex >= script.length;

  return (
    <div className="flex flex-col items-center animate-fade-in">
        <h2 className="text-3xl font-bold text-indigo-900 mb-6 flex items-center gap-2">
            <Video className="text-pink-500"/> Showtime!
        </h2>

        <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-black w-full max-w-4xl aspect-video border-4 border-gray-800">
            <canvas 
                ref={canvasRef} 
                width={1280} 
                height={720}
                className="w-full h-full object-contain"
            />
            
            {/* Buffering/Loading Overlay */}
            {(isPreparing || isBuffering) && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white z-20">
                    <Loader size={48} className="animate-spin mb-4"/>
                    <span className="text-xl font-bold">
                        {isPreparing ? "Preparing Recording..." : "Loading Scene..."}
                    </span>
                    <span className="text-sm opacity-70 mt-2">
                        {isPreparing ? "Making sure your video is perfect!" : "Just a sec!"}
                    </span>
                </div>
            )}
            
            {isRecording && !isPreparing && (
                <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2 animate-pulse z-20">
                    <div className="w-3 h-3 bg-white rounded-full"></div> REC
                </div>
            )}
        </div>

        <div className="flex gap-4 mt-8 flex-wrap justify-center">
            {/* Play/Replay Button */}
            <button
                onClick={togglePlay}
                disabled={isRecording || isPreparing}
                className={`flex items-center gap-2 px-8 py-4 rounded-full text-xl font-bold transition-all shadow-lg ${
                    (isRecording || isPreparing)
                     ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                     : isPlaying 
                        ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105'
                }`}
            >
                {isPlaying ? <Pause fill="currentColor" /> : (isFinished ? <RotateCcw /> : <Play fill="currentColor" />)}
                {isPlaying ? "Pause" : (isFinished ? "Replay" : "Play Movie")}
            </button>

            {/* Recording / Downloading Controls */}
            {isRecording ? (
                <button
                    onClick={handleCancelRecording}
                    className="flex items-center gap-2 px-6 py-4 rounded-full text-lg font-bold transition-all shadow-lg border-2 bg-red-100 border-red-500 text-red-600 hover:bg-red-200"
                >
                    <StopCircle /> Stop Recording
                </button>
            ) : recordedVideo ? (
                <>
                    <button
                        onClick={handleSaveVideo}
                        className="flex items-center gap-2 px-6 py-4 rounded-full text-lg font-bold transition-all shadow-lg border-2 bg-green-500 border-green-600 text-white hover:bg-green-600 animate-pulse"
                    >
                        <Download /> Download Video
                    </button>
                    <button
                        onClick={handleStartRecording}
                        className="flex items-center gap-2 px-6 py-4 rounded-full text-lg font-bold transition-all shadow-lg border-2 bg-white border-gray-300 text-gray-600 hover:bg-gray-100"
                        title="Record Again"
                    >
                        <RotateCcw size={20}/> Re-record
                    </button>
                </>
            ) : (
                <button
                    onClick={handleStartRecording}
                    disabled={isPlaying || isPreparing || isBuffering}
                    className={`flex items-center gap-2 px-6 py-4 rounded-full text-lg font-bold transition-all shadow-lg border-2 ${
                        (isPlaying || isPreparing || isBuffering)
                         ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                         : 'bg-white border-pink-500 text-pink-600 hover:bg-pink-50'
                    }`}
                >
                    {recordingInterrupted ? (
                        <><RotateCcw size={20} /> Re-record</>
                    ) : (
                        <><Disc size={20} /> Record Video</>
                    )}
                </button>
            )}
            
            <button
                onClick={onReset}
                disabled={isRecording || isPreparing}
                className="p-4 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 transition-all"
                title="Back Home"
            >
                <Home />
            </button>
        </div>
        
        <audio 
            ref={audioRef} 
            crossOrigin="anonymous" 
            onEnded={handleAudioEnded}
            className="hidden"
        />
    </div>
  );
};

export default VideoPlayer;
