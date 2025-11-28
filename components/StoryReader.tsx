import React, { useState, useRef, useEffect } from 'react';
import { Story } from '../types';
import { ChevronLeft, ChevronRight, BookOpen, Download, Volume2, StopCircle, Loader, Wand2, Mic, Square, X, Sparkles, RefreshCw, Play, Pause, Image as ImageIcon } from 'lucide-react';
import * as GeminiService from '../services/geminiService';

interface StoryReaderProps {
  story: Story;
  onFinish: () => void;
  onUpdatePage: (pageIndex: number, updates: Partial<any>) => void;
}

const StoryReader: React.FC<StoryReaderProps> = ({ story, onFinish, onUpdatePage }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [pageAudioUrls, setPageAudioUrls] = useState<Record<number, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Auto Play State
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const isAutoPlayingRef = useRef(false);
  
  const [isDownloading, setIsDownloading] = useState(false);

  // Magic Edit (Text) State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRegeneratingText, setIsRegeneratingText] = useState(false);
  const [editFeedback, setEditFeedback] = useState('');
  const [isRecordingEdit, setIsRecordingEdit] = useState(false);
  
  // Magic Picture (Image) State
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [imageFeedback, setImageFeedback] = useState('');
  const [isRecordingImage, setIsRecordingImage] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Keep ref in sync with state for access in callbacks
  useEffect(() => {
    isAutoPlayingRef.current = isAutoPlaying;
  }, [isAutoPlaying]);

  // Handle Page Changes & Auto Play
  useEffect(() => {
    // 1. Cleanup old audio
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    // 2. If Auto Play is active, start the new page's audio automatically
    if (isAutoPlaying) {
        // Small delay for smooth transition
        const timer = setTimeout(() => {
            playCurrentPageAudio();
        }, 500);
        return () => clearTimeout(timer);
    }
  }, [currentPage]);

  const handleNext = () => {
    if (currentPage < story.pages.length - 1) {
      setCurrentPage(prev => prev + 1);
    } else {
      // Reached the end
      if (isAutoPlaying) setIsAutoPlaying(false);
      onFinish();
    }
  };

  const handlePrev = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const playCurrentPageAudio = async () => {
    if (isLoadingAudio) return;

    // Check cache
    let url = pageAudioUrls[currentPage];

    // Generate if not cached
    if (!url) {
        setIsLoadingAudio(true);
        try {
          const text = story.pages[currentPage].text;
          const generatedUrl = await GeminiService.generateSpeech(text, 'Kore');
          if (generatedUrl) {
            setPageAudioUrls(prev => ({ ...prev, [currentPage]: generatedUrl }));
            url = generatedUrl;
          }
        } catch (e) {
          console.error(e);
          alert("Oops, I couldn't read the page right now.");
          setIsAutoPlaying(false); // Stop auto play on error
        } finally {
          setIsLoadingAudio(false);
        }
    }

    if (url && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(e => {
            console.error("Play failed", e);
            setIsPlaying(false);
            setIsAutoPlaying(false);
        });
        setIsPlaying(true);
        
        audioRef.current.onended = () => {
            if (isAutoPlayingRef.current) {
                // If auto-playing, move to next page
                if (currentPage < story.pages.length - 1) {
                    handleNext();
                } else {
                    // End of story
                    setIsAutoPlaying(false);
                    setIsPlaying(false);
                }
            } else {
                setIsPlaying(false);
            }
        };
    }
  };

  const toggleAutoPlay = () => {
      if (isAutoPlaying) {
          // User wants to Pause
          setIsAutoPlaying(false);
          if (audioRef.current) audioRef.current.pause();
          setIsPlaying(false);
      } else {
          // User wants to Start
          setIsAutoPlaying(true);
          // If not currently playing audio, start immediately
          if (!isPlaying) {
              playCurrentPageAudio();
          }
      }
  };

  // --- Voice Recording Logic (Generic) ---
  const startRecording = async (setRecordingState: (v: boolean) => void, onDataAvailable: (data: string) => void) => {
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
          reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            onDataAvailable(base64data);
            stream.getTracks().forEach(t => t.stop());
          };
      };
      recorder.start();
      setRecordingState(true);
    } catch(e) { console.error(e); alert("Can't access mic"); }
  };

  const stopRecording = (setRecordingState: (v: boolean) => void) => {
    mediaRecorderRef.current?.stop();
    setRecordingState(false);
  };

  // --- Magic Edit (Text) ---
  const handleEditRecordStart = () => startRecording(setIsRecordingEdit, async (base64) => {
      await applyEditChanges({ type: 'AUDIO', content: base64, mimeType: 'audio/webm' });
  });

  const applyEditChanges = async (feedback: { type: 'TEXT'|'AUDIO', content: string, mimeType?: string }) => {
    setIsRegeneratingText(true);
    try {
        const currentText = story.pages[currentPage].text;
        const storyContext = story.pages.map(p => p.text).join('\n');
        
        const newText = await GeminiService.regeneratePageContent(currentText, feedback, storyContext);
        onUpdatePage(currentPage, { text: newText });
        
        // Clear audio cache for this page since text changed
        setPageAudioUrls(prev => {
            const newState = {...prev};
            delete newState[currentPage];
            return newState;
        });

        setIsEditModalOpen(false);
        setEditFeedback('');
    } catch (e) {
        console.error(e);
        alert("Magic spell failed! Try again.");
    } finally {
        setIsRegeneratingText(false);
    }
  };

  // --- Magic Picture (Image) ---
  const handleImageRecordStart = () => startRecording(setIsRecordingImage, async (base64) => {
      await applyImageChanges({ type: 'AUDIO', content: base64, mimeType: 'audio/webm' });
  });

  const applyImageChanges = async (feedback: { type: 'TEXT'|'AUDIO', content: string, mimeType?: string }) => {
      setIsRegeneratingImage(true);
      try {
          const currentPrompt = story.pages[currentPage].imagePrompt;
          const newUrl = await GeminiService.regenerateIllustration(currentPrompt, feedback);
          onUpdatePage(currentPage, { imageUrl: newUrl });
          
          setIsImageModalOpen(false);
          setImageFeedback('');
      } catch (e) {
          console.error(e);
          alert("Couldn't redraw the picture.");
      } finally {
          setIsRegeneratingImage(false);
      }
  };


  // --- HTML Download ---
  const handleDownload = async () => {
    setIsDownloading(true);
    try {
        // 1. Get translations
        const translation = await GeminiService.getStoryTranslation(story);
        
        // 2. Construct HTML
        const vocabRegex = new RegExp(`(${story.vocabulary.join('|')})`, 'gi');
        const highlightText = (text: string) => {
            return text.replace(vocabRegex, (match) => 
                `<span style="color: #4338ca; font-weight: bold; background-color: #e0e7ff; padding: 0 4px; border-radius: 4px;">${match}</span>`
            );
        };

        const pagesHTML = story.pages.map((page, idx) => `
            <div style="margin-bottom: 60px; page-break-inside: avoid; text-align: center;">
                <div style="margin-bottom: 20px;">
                   <img src="${page.imageUrl}" style="max-width: 100%; height: auto; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);" />
                </div>
                <div style="font-size: 24px; line-height: 1.6; color: #1f2937; font-weight: 500; margin-bottom: 15px; font-family: 'Segoe UI', sans-serif;">
                    ${highlightText(page.text)}
                </div>
                <div style="font-size: 18px; line-height: 1.6; color: #6b7280; font-family: 'Microsoft YaHei', sans-serif;">
                    ${translation.pages[idx] || ''}
                </div>
                <div style="margin-top: 20px; color: #9ca3af; font-size: 14px;">- ${idx + 1} -</div>
            </div>
        `).join('');

        const contentHTML = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${story.title}</title>
              <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; background: #fff; }
                .cover { text-align: center; margin-bottom: 80px; page-break-after: always; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; }
                h1 { font-size: 4em; color: #4f46e5; margin-bottom: 10px; line-height: 1.1; }
                h2 { font-size: 2em; color: #9ca3af; margin-top: 0; font-weight: normal; margin-bottom: 40px; font-family: 'Microsoft YaHei', sans-serif; }
                .meta { background: #f3f4f6; padding: 30px; border-radius: 20px; width: 100%; max-width: 600px; text-align: left; }
                .label { font-weight: bold; text-transform: uppercase; color: #6b7280; font-size: 0.9em; letter-spacing: 1px; margin-bottom: 5px; }
                .items { font-size: 1.2em; color: #374151; margin-bottom: 20px; }
              </style>
            </head>
            <body>
                <div class="cover">
                    <h1>${story.title}</h1>
                    <h2>${translation.title}</h2>
                    
                    <div class="meta">
                        <div class="label">Characters / 角色</div>
                        <div class="items">${story.characters.join(', ')} <br> <span style="color:#6b7280; font-size:0.9em">${translation.characters.join(', ')}</span></div>
                        
                        <div class="label">Vocabulary / 单词</div>
                        <div class="items">${story.vocabulary.join(', ')} <br> <span style="color:#6b7280; font-size:0.9em">${translation.vocabulary.join(', ')}</span></div>
                    </div>
                </div>
                ${pagesHTML}
            </body>
            </html>
        `;

        const blob = new Blob([contentHTML], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${story.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
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

  const renderTextWithHighlights = (text: string) => {
    const vocab = story.vocabulary;
    if (!vocab || vocab.length === 0) return text;
    const regex = new RegExp(`\\b(${vocab.join('|')})\\b`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) => {
       const isVocab = vocab.some(v => v.toLowerCase() === part.toLowerCase());
       if (isVocab) {
         return (
           <span key={i} className="text-indigo-600 font-bold bg-indigo-100 px-1 rounded-md border-b-2 border-indigo-200 inline-block transform hover:scale-110 transition-transform cursor-pointer" title="Magic Word!">
             {part}
           </span>
         );
       }
       return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <audio ref={audioRef} className="hidden" />

      {/* Magic Edit Modal (TEXT) */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-white rounded-[2rem] p-8 max-w-md w-full relative shadow-2xl animate-fade-in">
                 <button onClick={() => setIsEditModalOpen(false)} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X /></button>
                 <h3 className="text-2xl font-bold text-purple-600 mb-6 text-center">Magic Wand 🪄</h3>
                 
                 {isRegeneratingText ? (
                     <div className="flex flex-col items-center py-8">
                         <Loader className="animate-spin text-purple-500 mb-4" size={48}/>
                         <span className="font-bold text-gray-500">The elves are rewriting...</span>
                     </div>
                 ) : (
                    <div className="space-y-6">
                        <button
                            onClick={isRecordingEdit ? () => stopRecording(setIsRecordingEdit) : handleEditRecordStart}
                            className={`w-full py-6 rounded-2xl flex flex-col items-center gap-2 transition-all ${isRecordingEdit ? 'bg-red-500 text-white shadow-red-200 shadow-lg' : 'bg-purple-100 text-purple-600 hover:bg-purple-200 border-2 border-purple-200'}`}
                        >
                            {isRecordingEdit ? <Square size={32} /> : <Mic size={32} />}
                            <span className="font-bold text-lg">{isRecordingEdit ? "Stop Magic" : "Hold & Speak (中文 / English)"}</span>
                        </button>
                        <div className="flex gap-2">
                            <input 
                                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-purple-400" 
                                placeholder="Or type (e.g. 'Add a dragon')"
                                value={editFeedback}
                                onChange={e => setEditFeedback(e.target.value)}
                            />
                            <button 
                                onClick={() => editFeedback && applyEditChanges({ type: 'TEXT', content: editFeedback })}
                                disabled={!editFeedback}
                                className="bg-purple-600 text-white px-6 rounded-xl font-bold disabled:opacity-50 hover:bg-purple-700 transition-colors"
                            >Go</button>
                        </div>
                    </div>
                 )}
             </div>
        </div>
      )}

      {/* Magic Picture Modal (IMAGE) */}
      {isImageModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-white rounded-[2rem] p-8 max-w-md w-full relative shadow-2xl animate-fade-in border-4 border-yellow-200">
                 <button onClick={() => setIsImageModalOpen(false)} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X /></button>
                 <h3 className="text-2xl font-bold text-yellow-600 mb-6 text-center flex items-center justify-center gap-2">Magic Paint <ImageIcon/></h3>
                 
                 {isRegeneratingImage ? (
                     <div className="flex flex-col items-center py-8">
                         <Loader className="animate-spin text-yellow-500 mb-4" size={48}/>
                         <span className="font-bold text-gray-500">Painting a new picture...</span>
                     </div>
                 ) : (
                    <div className="space-y-6">
                        <p className="text-center text-gray-500">How should I change the picture?</p>
                        <button
                            onClick={isRecordingImage ? () => stopRecording(setIsRecordingImage) : handleImageRecordStart}
                            className={`w-full py-6 rounded-2xl flex flex-col items-center gap-2 transition-all ${isRecordingImage ? 'bg-red-500 text-white shadow-red-200 shadow-lg' : 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200 border-2 border-yellow-200'}`}
                        >
                            {isRecordingImage ? <Square size={32} /> : <Mic size={32} />}
                            <span className="font-bold text-lg">{isRecordingImage ? "Stop Magic" : "Hold & Speak (中文 / English)"}</span>
                        </button>
                        <div className="flex gap-2">
                            <input 
                                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-yellow-400" 
                                placeholder="E.g. 'Add a big sun'"
                                value={imageFeedback}
                                onChange={e => setImageFeedback(e.target.value)}
                            />
                            <button 
                                onClick={() => imageFeedback && applyImageChanges({ type: 'TEXT', content: imageFeedback })}
                                disabled={!imageFeedback}
                                className="bg-yellow-500 text-white px-6 rounded-xl font-bold disabled:opacity-50 hover:bg-yellow-600 transition-colors"
                            >Go</button>
                        </div>
                    </div>
                 )}
             </div>
        </div>
      )}

      {/* Main Title Banner */}
      <div className="text-center mb-8 relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-indigo-900 tracking-tight drop-shadow-sm">
            {story.title}
        </h1>
        <div className="absolute -top-6 -right-6 hidden md:block">
            <Sparkles className="text-yellow-400 w-12 h-12 animate-pulse" />
        </div>
      </div>

      <div className="bg-white rounded-[3rem] shadow-2xl border-4 border-white overflow-hidden relative">
        {/* Top Controls */}
        <div className="absolute top-6 right-6 z-10 flex gap-2">
            <button
                onClick={() => setIsEditModalOpen(true)}
                className="bg-white/90 backdrop-blur text-purple-600 p-3 rounded-full shadow-lg hover:scale-110 transition-transform border border-purple-100 group"
                title="Change the story"
            >
                <Wand2 size={24} className="group-hover:rotate-12 transition-transform" />
            </button>
            <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="bg-white/90 backdrop-blur text-indigo-600 p-3 rounded-full shadow-lg hover:scale-110 transition-transform border border-indigo-100"
                title="Download Story"
            >
                {isDownloading ? <Loader className="animate-spin" size={24}/> : <Download size={24} />}
            </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-col md:flex-row min-h-[500px]">
          {/* Image Side */}
          <div className="md:w-1/2 bg-gray-100 relative group h-[300px] md:h-auto">
             <img 
               src={story.pages[currentPage].imageUrl || "https://picsum.photos/600/600"} 
               alt={`Page ${currentPage + 1}`}
               className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
             />
             <button 
                onClick={() => setIsImageModalOpen(true)}
                className="absolute bottom-4 right-4 bg-white/90 backdrop-blur p-2 rounded-full shadow-lg text-gray-700 hover:bg-white transition-all transform hover:scale-110"
                title="New Picture"
             >
                <RefreshCw size={20}/>
             </button>
             <div className="absolute bottom-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm font-bold backdrop-blur-sm">
                 {currentPage + 1} / {story.pages.length}
             </div>
          </div>

          {/* Text Side */}
          <div className="md:w-1/2 p-8 md:p-12 flex flex-col justify-center bg-gradient-to-br from-white to-indigo-50 relative">
             <div className="flex-1 flex items-center">
                 <p className="text-xl md:text-2xl leading-relaxed text-gray-700 font-medium">
                   {renderTextWithHighlights(story.pages[currentPage].text)}
                 </p>
             </div>
             
             <div className="mt-8 flex justify-center">
                <button
                   onClick={toggleAutoPlay}
                   disabled={isLoadingAudio}
                   className={`flex items-center gap-3 px-6 py-4 rounded-full text-lg font-bold shadow-lg transition-all transform hover:-translate-y-1 min-w-[200px] justify-center ${
                       isAutoPlaying 
                         ? 'bg-red-50 text-red-500 ring-2 ring-red-200 hover:bg-red-100' 
                         : 'bg-indigo-600 text-white hover:bg-indigo-700 ring-4 ring-indigo-100'
                   }`}
                >
                   {isLoadingAudio ? <Loader className="animate-spin"/> : isAutoPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                   {isAutoPlaying ? "Pause" : "Auto Play"}
                </button>
             </div>
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="bg-gray-50 p-4 flex justify-between items-center border-t border-gray-100">
           <button 
             onClick={handlePrev} 
             disabled={currentPage === 0}
             className="p-4 rounded-full hover:bg-white hover:shadow-md disabled:opacity-30 disabled:hover:shadow-none transition-all text-gray-500"
           >
             <ChevronLeft size={32} />
           </button>

           <div className="flex gap-2">
              {story.pages.map((_, idx) => (
                  <div 
                    key={idx} 
                    className={`h-2 rounded-full transition-all duration-300 ${idx === currentPage ? 'w-8 bg-indigo-500' : 'w-2 bg-gray-300'}`} 
                  />
              ))}
           </div>

           <button 
             onClick={handleNext}
             className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold shadow-lg transition-all transform hover:-translate-y-1 ${
                 currentPage === story.pages.length - 1 
                 ? 'bg-green-500 text-white hover:bg-green-600 hover:shadow-green-200' 
                 : 'bg-white text-gray-600 hover:text-indigo-600 hover:shadow-md'
             }`}
           >
             {currentPage === story.pages.length - 1 ? (
                 <>Act Out Story <BookOpen size={20}/></>
             ) : (
                 <ChevronRight size={32} />
             )}
           </button>
        </div>
      </div>
    </div>
  );
};

export default StoryReader;