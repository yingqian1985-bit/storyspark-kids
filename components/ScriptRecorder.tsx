import React, { useState, useRef, useEffect } from 'react';
import { RolePlayLine, Story } from '../types';
import { Mic, Square, Play, RefreshCw, CheckCircle, Volume2, StopCircle, Users, ChevronLeft, ChevronRight, Wand2, X, Loader, Download, ArrowLeft, Pause, Trash2 } from 'lucide-react';
import * as GeminiService from '../services/geminiService';

interface ScriptRecorderProps {
  story: Story;
  script: RolePlayLine[];
  onComplete: (recordedScript: RolePlayLine[]) => void;
  onBack: () => void;
}

const AVAILABLE_VOICES = ['Puck', 'Kore', 'Fenrir', 'Charon', 'Zephyr'] as const;

const ScriptRecorder: React.FC<ScriptRecorderProps> = ({ story, script, onComplete, onBack }) => {
  const [lines, setLines] = useState<RolePlayLine[]>(script);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // TTS State
  // We use IDs for TTS playback, and 'user-{id}' for user recording playback
  const [ttsAudioUrls, setTtsAudioUrls] = useState<Record<string, string>>({}); 
  const [isPlayingTts, setIsPlayingTts] = useState<string | null>(null); 
  const [loadingTts, setLoadingTts] = useState<string | null>(null); 
  const characterVoicesRef = useRef<Record<string, typeof AVAILABLE_VOICES[number]>>({});
  
  // Ref to track play status within loops
  const isScenePlayingRef = useRef(false);
  
  // Global Auto Play (All Scenes)
  const [isGlobalAutoPlay, setIsGlobalAutoPlay] = useState(false);
  const isGlobalAutoPlayRef = useRef(false);

  // Edit/Regenerate Dialogue State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [editFeedback, setEditFeedback] = useState('');
  const [isRecordingEdit, setIsRecordingEdit] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync ref
  useEffect(() => { isGlobalAutoPlayRef.current = isGlobalAutoPlay; }, [isGlobalAutoPlay]);

  // Group lines by pageIndex (Scene)
  const scenes = React.useMemo(() => {
    const grouped: Record<number, RolePlayLine[]> = {};
    story.pages.forEach((_, idx) => { grouped[idx] = []; });
    lines.forEach(line => {
      const pIdx = line.pageIndex ?? 0;
      if (!grouped[pIdx]) grouped[pIdx] = [];
      grouped[pIdx].push(line);
    });
    return grouped;
  }, [lines, story.pages]);

  const sceneIndices = Object.keys(scenes).map(Number).sort((a, b) => a - b);
  const currentLines = scenes[currentSceneIdx] || [];

  // Assign voices
  useEffect(() => {
    const chars = Array.from(new Set(lines.map(l => l.character)));
    chars.forEach((char, idx) => {
      if (!characterVoicesRef.current[char]) {
        characterVoicesRef.current[char] = AVAILABLE_VOICES[idx % AVAILABLE_VOICES.length];
      }
    });
  }, [lines]);

  // Handle Global Auto Play: Next Scene
  useEffect(() => {
      if (isGlobalAutoPlay) {
          playSceneDialogue();
      }
  }, [currentSceneIdx]); // Trigger when scene changes

  // Stop everything if global play is toggled off
  useEffect(() => {
      if (!isGlobalAutoPlay) {
          isScenePlayingRef.current = false;
          // Don't stop audioRef here immediately as we might be pausing manually but audio finishes naturally.
          // But generally safe to stop if user explicitly cancelled.
      }
  }, [isGlobalAutoPlay]);


  const toggleGlobalAutoPlay = () => {
      if (isGlobalAutoPlay) {
          setIsGlobalAutoPlay(false);
          isScenePlayingRef.current = false;
          audioRef.current?.pause();
          setIsPlayingTts(null);
      } else {
          setIsGlobalAutoPlay(true);
          // If scene loop is not running, start it. 
          // If it is running, the state update to true ensures it continues to next scene at end.
          if (!isScenePlayingRef.current) {
             playSceneDialogue();
          }
      }
  };

  const playSceneDialogue = async () => {
    if (isScenePlayingRef.current) return; // Already running

    isScenePlayingRef.current = true;

    for (const line of currentLines) {
        if (!isScenePlayingRef.current) break;
        // Check global flag too in case it was turned off during loop
        if (isGlobalAutoPlayRef.current && !isGlobalAutoPlayRef.current) break; 

        document.getElementById(`line-${line.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setIsPlayingTts(line.id);
        
        let url = ttsAudioUrls[line.id];
        if (!url) {
            setLoadingTts(line.id);
            try {
                const voice = characterVoicesRef.current[line.character] || 'Puck';
                const generated = await GeminiService.generateSpeech(line.text, voice);
                if (generated) {
                    url = generated;
                    setTtsAudioUrls(prev => ({ ...prev, [line.id]: generated }));
                }
            } catch (e) { console.error(e); } 
            finally { setLoadingTts(null); }
        }

        if (url && isScenePlayingRef.current) {
            await new Promise<void>((resolve) => {
                if (!audioRef.current) return resolve();
                audioRef.current.src = url;
                audioRef.current.onended = () => resolve();
                audioRef.current.play().catch(resolve);
            });
        }
        
        if (isScenePlayingRef.current) await new Promise(r => setTimeout(r, 500));
    }
    
    isScenePlayingRef.current = false;
    setIsPlayingTts(null);

    // End of Scene - Check Global Auto Play
    if (isGlobalAutoPlayRef.current) {
        if (currentSceneIdx < sceneIndices.length - 1) {
            setCurrentSceneIdx(prev => prev + 1); // Triggers useEffect to play next
        } else {
            setIsGlobalAutoPlay(false); // Finished all scenes
        }
    }
  };

  const playLineAudio = async (line: RolePlayLine) => {
    // Stop any auto-play loop or user audio
    isScenePlayingRef.current = false;
    setIsGlobalAutoPlay(false);
    
    if (isPlayingTts === line.id) {
        audioRef.current?.pause();
        setIsPlayingTts(null);
        return;
    }
    
    setIsPlayingTts(line.id);
    // ... load/play ...
    let url = ttsAudioUrls[line.id];
    if (!url) {
        setLoadingTts(line.id);
        try {
            const voice = characterVoicesRef.current[line.character] || 'Puck';
            url = await GeminiService.generateSpeech(line.text, voice) || '';
            if (url) setTtsAudioUrls(prev => ({ ...prev, [line.id]: url }));
        } catch (e) { console.error(e); } 
        finally { setLoadingTts(null); }
    }
    if (url && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        audioRef.current.onended = () => setIsPlayingTts(null);
    }
  };

  const playUserAudio = (line: RolePlayLine) => {
    // Stop auto-play and TTS
    isScenePlayingRef.current = false;
    setIsGlobalAutoPlay(false);
    audioRef.current?.pause();
    
    const userAudioId = `user-${line.id}`;

    if (isPlayingTts === userAudioId) {
        setIsPlayingTts(null);
        audioRef.current?.pause(); // Ensure we actually pause
        return;
    }

    if (line.audioUrl && audioRef.current) {
        setIsPlayingTts(userAudioId);
        audioRef.current.src = line.audioUrl;
        audioRef.current.play();
        audioRef.current.onended = () => setIsPlayingTts(null);
    }
  };

  const startRecordingLine = async (lineId: string) => {
    // Stop playback
    isScenePlayingRef.current = false;
    setIsGlobalAutoPlay(false);
    audioRef.current?.pause();
    setIsPlayingTts(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone permission needed.");
        return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setLines(prev => prev.map(l => l.id === lineId ? { ...l, audioUrl: url } : l));
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setIsRecording(true);
      setActiveLineId(lineId);
    } catch (err: any) {
        console.error(err);
        alert("Could not access microphone.");
    }
  };

  const stopRecordingLine = () => {
    if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setActiveLineId(null);
    }
  };

  const deleteRecording = (lineId: string) => {
      // Stop playback if active on this line
      if (isPlayingTts === `user-${lineId}`) {
         audioRef.current?.pause();
         setIsPlayingTts(null);
      }
      
      // Removed window.confirm for faster, non-blocking interaction.
      // Simply clears the recording so user can record again.
      setLines(prev => prev.map(l => l.id === lineId ? { ...l, audioUrl: undefined } : l));
  };

  // --- Magic Edit Logic ---
  const startRecordingEdit = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' }); 
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            const base64data = (reader.result as string).split(',')[1];
            await applyEditChanges({ type: 'AUDIO', content: base64data, mimeType: 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
          };
      };
      recorder.start();
      setIsRecordingEdit(true);
    } catch(e) { console.error(e); }
  };

  const stopRecordingEdit = () => {
    mediaRecorderRef.current?.stop();
    setIsRecordingEdit(false);
  };

  const applyEditChanges = async (feedback: { type: 'TEXT'|'AUDIO', content: string, mimeType?: string }) => {
    setIsRegenerating(true);
    try {
        const storyContext = story.pages[currentSceneIdx]?.text || "";
        const newSceneLines = await GeminiService.regenerateScriptForPage(
            currentLines,
            feedback,
            storyContext,
            currentSceneIdx,
            story.characters
        );
        setLines(prev => {
            const otherLines = prev.filter(l => l.pageIndex !== currentSceneIdx);
            return [...otherLines, ...newSceneLines].sort((a,b) => (a.pageIndex - b.pageIndex));
        });
        setIsEditModalOpen(false);
        setEditFeedback('');
    } catch (e) {
        console.error(e);
        alert("Script update failed.");
    } finally {
        setIsRegenerating(false);
    }
  };

  // --- Download Functionality (HTML) ---
  const handleDownloadScript = async () => {
    setIsDownloading(true);
    try {
        const translationMap = await GeminiService.getScriptTranslation(lines);
        const vocabRegex = new RegExp(`(${story.vocabulary.join('|')})`, 'gi');
        const highlightText = (text: string) => {
            return text.replace(vocabRegex, (match) => 
                `<span style="color: #4338ca; font-weight: bold; background-color: #e0e7ff; padding: 0 4px; border-radius: 4px;">${match}</span>`
            );
        };

        const scenesHTML = sceneIndices.map(idx => {
            const sceneLines = scenes[idx] || [];
            if (sceneLines.length === 0) return '';
            const sceneImage = story.pages[idx]?.imageUrl;

            return `
                <div style="margin-bottom: 40px; page-break-inside: avoid; border-bottom: 2px dashed #eee; padding-bottom: 30px;">
                    <div style="background: #fef3c7; color: #92400e; padding: 10px 20px; border-radius: 10px; font-weight: bold; margin-bottom: 20px; border-left: 5px solid #f59e0b;">
                        Scene ${idx + 1}
                    </div>
                    ${sceneImage ? `
                    <div style="text-align: center; margin-bottom: 25px;">
                       <img src="${sceneImage}" style="max-width: 100%; height: auto; max-height: 350px; border-radius: 15px; border: 4px solid #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
                    </div>
                    ` : ''}
                    ${sceneLines.map(line => `
                        <div style="margin-bottom: 20px; padding-left: 20px;">
                            <div style="font-weight: bold; color: #be185d; margin-bottom: 4px; font-size: 18px;">${line.character}:</div>
                            <div style="font-size: 18px; color: #1f2937; line-height: 1.6; margin-bottom: 6px;">
                                ${highlightText(line.text)}
                            </div>
                            <div style="font-size: 14px; color: #6b7280; font-style: italic;">
                                ${translationMap[line.id] || ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }).join('');

        const contentHTML = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${story.title} - Script</title>
              <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; background: #fff; }
                .header { text-align: center; margin-bottom: 50px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
              </style>
            </head>
            <body>
                <div class="header">
                    <h1 style="color: #4338ca; font-size: 3em; margin: 0;">${story.title}</h1>
                    <p style="color: #6b7280; font-size: 1.5em; margin-top: 10px;">Role-Play Script</p>
                </div>
                ${scenesHTML}
            </body>
            </html>
        `;

        const blob = new Blob([contentHTML], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${story.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_script.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alert("Download failed.");
    } finally {
        setIsDownloading(false);
    }
  };

  const currentStoryPage = story.pages[currentSceneIdx];
  const renderTextWithHighlights = (text: string) => {
    const vocab = story.vocabulary;
    if (!vocab || vocab.length === 0) return text;
    const regex = new RegExp(`(${vocab.join('|')})`, 'gi');
    return text.split(regex).map((part, i) => 
      vocab.some(v => v.toLowerCase() === part.toLowerCase()) 
        ? <span key={i} className="text-indigo-600 font-bold bg-indigo-100 px-1 rounded-md">{part}</span> 
        : <span key={i}>{part}</span>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <audio ref={audioRef} className="hidden" />
      
      {/* Magic Edit Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-white rounded-[2rem] p-8 max-w-md w-full relative shadow-2xl animate-fade-in">
                 <button onClick={() => setIsEditModalOpen(false)} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X /></button>
                 <h3 className="text-2xl font-bold text-purple-600 mb-6 text-center">Director's Chair 🎬</h3>
                 
                 {isRegenerating ? (
                     <div className="flex flex-col items-center py-8">
                         <Loader className="animate-spin text-purple-500 mb-4" size={48}/>
                         <span className="font-bold text-gray-500">Rewriting script...</span>
                     </div>
                 ) : (
                    <div className="space-y-6">
                        <button
                            onClick={isRecordingEdit ? stopRecordingEdit : startRecordingEdit}
                            className={`w-full py-6 rounded-2xl flex flex-col items-center gap-2 transition-all ${isRecordingEdit ? 'bg-red-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
                        >
                            {isRecordingEdit ? <Square size={32} /> : <Mic size={32} />}
                            <span className="font-bold">{isRecordingEdit ? "Stop Recording" : "Hold & Speak (中文 / English)"}</span>
                        </button>
                        <div className="flex gap-2">
                            <input 
                                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-2" 
                                placeholder="Or type e.g. 'Make it funnier'"
                                value={editFeedback}
                                onChange={e => setEditFeedback(e.target.value)}
                            />
                            <button 
                                onClick={() => editFeedback && applyEditChanges({ type: 'TEXT', content: editFeedback })}
                                disabled={!editFeedback}
                                className="bg-purple-600 text-white px-4 rounded-xl font-bold disabled:opacity-50"
                            >Go</button>
                        </div>
                    </div>
                 )}
             </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-yellow-100">
        <h2 className="text-2xl font-bold text-indigo-900 flex items-center gap-2">
            <Users className="text-indigo-500" /> Acting Time!
        </h2>
        
        {/* Main Controls */}
        <div className="flex flex-wrap gap-3 justify-center items-center">
             <button
                onClick={toggleGlobalAutoPlay}
                className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all shadow-md ${
                    isGlobalAutoPlay 
                        ? 'bg-red-50 text-red-600 ring-2 ring-red-200 hover:bg-red-100' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 ring-4 ring-indigo-100'
                }`}
             >
                {isGlobalAutoPlay ? <Pause size={20}/> : <Play size={20}/>}
                {isGlobalAutoPlay ? "Pause" : "Auto Play"}
             </button>

             <button
                onClick={onBack}
                className="flex items-center gap-2 bg-gray-100 text-gray-600 px-4 py-2 rounded-full font-bold hover:bg-gray-200 transition-colors"
             >
                <ArrowLeft size={20} /> Back
             </button>
             <button 
                onClick={handleDownloadScript}
                disabled={isDownloading}
                className="flex items-center gap-2 bg-yellow-100 text-yellow-700 px-4 py-2 rounded-full font-bold hover:bg-yellow-200 transition-colors"
             >
                 {isDownloading ? <Loader className="animate-spin" size={20}/> : <Download size={20}/>}
                 HTML
             </button>
             <button onClick={() => onComplete(lines)} className="bg-green-500 text-white px-6 py-2 rounded-full font-bold shadow-lg shadow-green-200 hover:bg-green-600 hover:scale-105 transition-all">
                Finish & Watch
             </button>
        </div>
      </div>

      {/* Scene Navigator */}
      <div className="bg-white rounded-[2.5rem] shadow-xl overflow-hidden border-4 border-indigo-50">
          <div className="bg-indigo-50 p-4 flex justify-between items-center border-b border-indigo-100">
              <button 
                onClick={() => setCurrentSceneIdx(i => Math.max(0, i-1))}
                disabled={currentSceneIdx === 0}
                className="p-2 rounded-full hover:bg-white disabled:opacity-30"
              ><ChevronLeft /></button>
              
              <span className="font-bold text-indigo-800 text-lg">Scene {currentSceneIdx + 1} of {sceneIndices.length}</span>
              
              <button 
                onClick={() => setCurrentSceneIdx(i => Math.min(sceneIndices.length-1, i+1))}
                disabled={currentSceneIdx === sceneIndices.length - 1}
                className="p-2 rounded-full hover:bg-white disabled:opacity-30"
              ><ChevronRight /></button>
          </div>

          <div className="p-6 md:p-8">
             {/* Scene Context */}
             <div className="flex flex-col md:flex-row gap-8 mb-8">
                 <div className="md:w-1/3">
                     <img 
                        src={currentStoryPage?.imageUrl || "https://picsum.photos/400/300"} 
                        className="rounded-2xl shadow-md w-full object-cover aspect-[4/3]"
                        alt="Scene reference"
                     />
                 </div>
                 <div className="md:w-2/3 space-y-4">
                     <div className="flex justify-between items-start">
                         <h3 className="text-xl font-bold text-gray-700">Dialogue</h3>
                         <div className="flex gap-2">
                             <button 
                                onClick={() => setIsEditModalOpen(true)}
                                className="flex items-center gap-2 bg-purple-100 text-purple-600 px-3 py-1 rounded-full text-sm font-bold hover:bg-purple-200"
                             >
                                 <Wand2 size={16} /> Edit
                             </button>
                         </div>
                     </div>
                     
                     <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                         {currentLines.length === 0 ? (
                             <div className="text-center py-10 text-gray-400 italic">No dialogue for this scene.</div>
                         ) : (
                             currentLines.map((line) => (
                                 <div 
                                    key={line.id} 
                                    id={`line-${line.id}`}
                                    className={`relative p-4 rounded-2xl border-2 transition-all ${
                                        activeLineId === line.id ? 'border-red-400 bg-red-50' : 
                                        isPlayingTts === line.id || isPlayingTts === `user-${line.id}` ? 'border-blue-400 bg-blue-50 scale-[1.02]' :
                                        'border-gray-100 hover:border-indigo-100 bg-gray-50'
                                    }`}
                                 >
                                     <div className="flex justify-between items-start mb-2">
                                         <span className="font-bold text-pink-600 bg-pink-50 px-2 py-0.5 rounded-lg text-sm uppercase tracking-wide">
                                             {line.character}
                                         </span>
                                         <div className="flex gap-2 items-center">
                                             {/* TTS Button */}
                                             <button 
                                                onClick={() => playLineAudio(line)}
                                                className={`p-1.5 rounded-full transition-colors ${
                                                    isPlayingTts === line.id ? 'bg-blue-500 text-white' : 'bg-white text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                                                }`}
                                             >
                                                {loadingTts === line.id ? <Loader size={16} className="animate-spin"/> : <Volume2 size={16} />}
                                             </button>

                                             {/* Record/Playback Control */}
                                             {line.audioUrl ? (
                                                <div className="flex items-center gap-1 bg-green-50 rounded-full p-1 border border-green-100">
                                                     <button
                                                         onClick={() => playUserAudio(line)}
                                                         className={`p-1.5 rounded-full transition-colors ${isPlayingTts === `user-${line.id}` ? 'bg-green-500 text-white' : 'text-green-600 hover:bg-green-100'}`}
                                                         title="Play recording"
                                                     >
                                                         {isPlayingTts === `user-${line.id}` ? <Square size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}
                                                     </button>
                                                     <button
                                                         onClick={() => deleteRecording(line.id)}
                                                         className="p-1.5 rounded-full text-red-400 hover:bg-red-100 hover:text-red-500 transition-colors"
                                                         title="Re-record"
                                                     >
                                                         <RefreshCw size={14} />
                                                     </button>
                                                </div>
                                             ) : (
                                                 <button
                                                     onClick={() => activeLineId === line.id ? stopRecordingLine() : startRecordingLine(line.id)}
                                                     className={`p-1.5 rounded-full transition-colors ${
                                                         activeLineId === line.id ? 'bg-red-500 text-white animate-pulse' : 
                                                         'bg-white text-gray-400 hover:text-red-500 hover:bg-red-50'
                                                     }`}
                                                 >
                                                     {activeLineId === line.id ? <Square size={16} fill="currentColor"/> : <Mic size={16} />}
                                                 </button>
                                             )}
                                         </div>
                                     </div>
                                     
                                     <p className="text-lg text-gray-800 font-medium leading-relaxed">
                                         {renderTextWithHighlights(line.text)}
                                     </p>

                                     {line.audioUrl && activeLineId !== line.id && (
                                         <div className="mt-2 flex items-center gap-2 text-xs text-green-600 font-bold bg-green-50 inline-block px-2 py-1 rounded-md">
                                             <CheckCircle size={12} /> Recorded
                                         </div>
                                     )}
                                 </div>
                             ))
                         )}
                     </div>
                 </div>
             </div>
          </div>
      </div>
    </div>
  );
};

export default ScriptRecorder;