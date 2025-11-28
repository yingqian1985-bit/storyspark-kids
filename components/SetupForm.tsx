import React, { useState, useRef } from 'react';
import { EnglishLevel } from '../types';
import { Plus, X, Sparkles, Mic, Square, Loader, Keyboard, Volume2 } from 'lucide-react';
import * as GeminiService from '../services/geminiService';

interface SetupFormProps {
  onGenerate: (characters: string[], words: string[], level: EnglishLevel) => void;
  isGenerating: boolean;
}

const SetupForm: React.FC<SetupFormProps> = ({ onGenerate, isGenerating }) => {
  const [characters, setCharacters] = useState<string[]>(['Rabbit', 'Robot']);
  const [newChar, setNewChar] = useState('');
  const [words, setWords] = useState<string[]>(['Friend', 'Adventure']);
  const [newWord, setNewWord] = useState('');
  const [level, setLevel] = useState<EnglishLevel>(EnglishLevel.BEGINNER);
  const [showKeyboard, setShowKeyboard] = useState<Record<string, boolean>>({ chars: false, words: false });

  // Voice Input Logic Component
  const VoiceInput = ({ 
    onResult, 
    label,
    bgColor,
    activeColor,
    type 
  }: { 
    onResult: (items: string[]) => void; 
    label: string;
    bgColor: string;
    activeColor: string;
    type: 'CHARACTERS' | 'WORDS';
  }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startRecording = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser does not support audio recording.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
        recorder.onstop = async () => {
          setIsProcessing(true);
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' }); 
          
          // Convert to base64
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            const base64data = (reader.result as string).split(',')[1];
            try {
              const items = await GeminiService.extractInputsFromAudio(base64data, 'audio/webm', type);
              if (items && items.length > 0) {
                onResult(items);
              } else {
                alert("I couldn't hear any words. Try speaking closer to the mic!");
              }
            } catch (err: any) {
              console.error(err);
              if (err.message === 'QUOTA_EXCEEDED') {
                  alert("You've used all your magic voice tokens for now! Please type your words instead.");
                  // Auto-open keyboard for convenience
                  if (type === 'CHARACTERS') setShowKeyboard(prev => ({...prev, chars: true}));
                  if (type === 'WORDS') setShowKeyboard(prev => ({...prev, words: true}));
              } else {
                  alert("Oops, I couldn't hear that clearly. Try again!");
              }
            } finally {
              setIsProcessing(false);
            }
          };
          
          // Stop all tracks to release microphone
          stream.getTracks().forEach(t => t.stop());
        };

        recorder.start();
        setIsRecording(true);
      } catch (err: any) {
        console.error("Mic error:", err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDismissedError') {
          alert("Microphone access was denied. Please click the lock icon in your address bar to allow microphone access.");
        } else {
          alert("Could not start recording. Please check your microphone settings.");
        }
      }
    };

    const stopRecording = () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    };

    return (
      <div className="w-full">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center p-8 bg-white rounded-3xl border-4 border-dashed border-gray-200 animate-pulse">
            <Loader className={`animate-spin mb-3 ${activeColor}`} size={48} />
            <span className={`font-bold text-xl ${activeColor}`}>Translating...</span>
          </div>
        ) : isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="w-full flex flex-col items-center justify-center p-8 bg-red-50 rounded-3xl border-4 border-red-200 hover:bg-red-100 transition-all group"
          >
            <div className="p-6 bg-red-500 rounded-full shadow-lg shadow-red-200 animate-pulse mb-3 group-hover:scale-110 transition-transform">
               <Square size={48} className="text-white fill-current" />
            </div>
            <span className="font-bold text-2xl text-red-500">Stop Recording</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            className={`w-full flex flex-col items-center justify-center p-8 ${bgColor} rounded-3xl border-b-8 border-transparent hover:border-black/5 hover:-translate-y-1 active:translate-y-0 active:border-transparent transition-all shadow-sm`}
          >
            <div className={`p-6 ${activeColor.replace('text-', 'bg-')} rounded-full shadow-lg mb-3`}>
               <Mic size={48} className="text-white" />
            </div>
            <span className={`font-bold text-xl md:text-2xl ${activeColor}`}>{label}</span>
            <span className="text-gray-400 text-sm mt-1">(Chinese supported!)</span>
          </button>
        )}
      </div>
    );
  };

  const addChar = () => {
    if (newChar.trim()) {
      setCharacters([...characters, newChar.trim()]);
      setNewChar('');
    }
  };

  const addWord = () => {
    if (newWord.trim()) {
      setWords([...words, newWord.trim()]);
      setNewWord('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (characters.length > 0 && words.length > 0) {
      onGenerate(characters, words, level);
    }
  };

  const toggleKeyboard = (key: 'chars' | 'words') => {
    setShowKeyboard(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-[2.5rem] shadow-xl border-4 border-yellow-300 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-100 rounded-bl-full -z-0 opacity-50"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-100 rounded-tr-full -z-0 opacity-50"></div>

      <div className="text-center mb-10 relative z-10">
        <h2 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600 mb-4 tracking-tight">
          Story Magic! 🎨
        </h2>
        <p className="text-xl text-gray-500 font-medium">Tap the mic & say it in Chinese or English!</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-12 relative z-10">
        
        {/* Step 1: Characters */}
        <div className="bg-indigo-50/50 p-6 rounded-3xl border-2 border-indigo-50">
          <div className="flex justify-between items-end mb-6">
             <div className="flex items-center gap-3">
               <span className="flex items-center justify-center w-10 h-10 bg-indigo-600 text-white rounded-full font-bold text-xl shadow-lg">1</span>
               <label className="text-2xl font-bold text-gray-700">Characters</label>
             </div>
             <button type="button" onClick={() => toggleKeyboard('chars')} className="text-gray-400 hover:text-indigo-600 transition-colors p-2 hover:bg-indigo-100 rounded-full">
               <Keyboard size={24} />
             </button>
          </div>
          
          <div className="space-y-6">
             <VoiceInput 
               type="CHARACTERS"
               label="Who is in the story?" 
               bgColor="bg-indigo-100"
               activeColor="text-indigo-600"
               onResult={(items) => setCharacters(prev => [...prev, ...items])} 
             />
             
             {showKeyboard.chars && (
               <div className="flex gap-2 items-center animate-fade-in bg-white p-2 rounded-2xl shadow-sm border border-indigo-100">
                  <input
                    type="text"
                    value={newChar}
                    onChange={(e) => setNewChar(e.target.value)}
                    placeholder="Type name (e.g. Rabbit)..."
                    className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-indigo-400 outline-none font-medium text-lg"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChar())}
                  />
                  <button
                    type="button"
                    onClick={addChar}
                    className="bg-indigo-100 text-indigo-600 p-3 rounded-xl hover:bg-indigo-200 transition-colors"
                  >
                    <Plus size={28} />
                  </button>
               </div>
             )}

            <div className="flex flex-wrap gap-3">
              {characters.length === 0 && <span className="text-indigo-300 italic px-2">List is empty...</span>}
              {characters.map((char, idx) => (
                <span key={idx} className="bg-indigo-500 text-white px-5 py-2 rounded-2xl flex items-center gap-2 font-bold text-lg shadow-md hover:scale-105 transition-transform cursor-default">
                  {char}
                  <button type="button" onClick={() => setCharacters(characters.filter((_, i) => i !== idx))} className="bg-indigo-600 rounded-full p-1 hover:bg-indigo-400">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Step 2: Words */}
        <div className="bg-green-50/50 p-6 rounded-3xl border-2 border-green-50">
          <div className="flex justify-between items-end mb-6">
             <div className="flex items-center gap-3">
               <span className="flex items-center justify-center w-10 h-10 bg-green-500 text-white rounded-full font-bold text-xl shadow-lg">2</span>
               <label className="text-2xl font-bold text-gray-700">Magic Words</label>
             </div>
             <button type="button" onClick={() => toggleKeyboard('words')} className="text-gray-400 hover:text-green-600 transition-colors p-2 hover:bg-green-100 rounded-full">
               <Keyboard size={24} />
             </button>
          </div>

          <div className="space-y-6">
             <VoiceInput 
               type="WORDS"
               label="Say words to learn!" 
               bgColor="bg-green-100"
               activeColor="text-green-600"
               onResult={(items) => setWords(prev => [...prev, ...items])} 
             />

             {showKeyboard.words && (
               <div className="flex gap-2 items-center animate-fade-in bg-white p-2 rounded-2xl shadow-sm border border-green-100">
                  <input
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="Type word (e.g. Happy)..."
                    className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-green-400 outline-none font-medium text-lg"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addWord())}
                  />
                  <button
                    type="button"
                    onClick={addWord}
                    className="bg-green-100 text-green-600 p-3 rounded-xl hover:bg-green-200 transition-colors"
                  >
                    <Plus size={28} />
                  </button>
               </div>
             )}

            <div className="flex flex-wrap gap-3">
              {words.length === 0 && <span className="text-green-300 italic px-2">List is empty...</span>}
              {words.map((word, idx) => (
                <span key={idx} className="bg-green-500 text-white px-5 py-2 rounded-2xl flex items-center gap-2 font-bold text-lg shadow-md hover:scale-105 transition-transform cursor-default">
                  {word}
                  <button type="button" onClick={() => setWords(words.filter((_, i) => i !== idx))} className="bg-green-600 rounded-full p-1 hover:bg-green-400">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Step 3: Level */}
        <div className="bg-orange-50/50 p-6 rounded-3xl border-2 border-orange-50">
          <div className="flex items-center gap-3 mb-6">
             <span className="flex items-center justify-center w-10 h-10 bg-orange-500 text-white rounded-full font-bold text-xl shadow-lg">3</span>
             <label className="text-2xl font-bold text-gray-700">My Level</label>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.values(EnglishLevel).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                className={`p-4 rounded-2xl border-b-4 text-center transition-all ${
                  level === lvl
                    ? 'border-orange-500 bg-orange-100 text-orange-800 shadow-inner'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="text-lg font-bold">{lvl.split('(')[0]}</div>
                <div className="text-xs opacity-70 mt-1">{lvl.split('(')[1].replace(')', '')}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isGenerating || characters.length === 0}
          className={`w-full py-6 rounded-3xl text-3xl font-extrabold text-white shadow-xl shadow-indigo-200 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-4 ${
            isGenerating || characters.length === 0
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader className="animate-spin" size={32} />
              Making Magic...
            </>
          ) : (
            <>
              <Sparkles className="animate-pulse" size={32} /> Create Story!
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default SetupForm;