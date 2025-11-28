import React, { useState, useEffect } from 'react';
import { Story, EnglishLevel, AppMode, RolePlayLine } from './types';
import * as GeminiService from './services/geminiService';
import SetupForm from './components/SetupForm';
import StoryReader from './components/StoryReader';
import ScriptRecorder from './components/ScriptRecorder';
import VideoPlayer from './components/VideoPlayer';
import AccessGate from './components/AccessGate';
import { Book, Star, Calendar } from 'lucide-react';

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.SETUP);
  const [story, setStory] = useState<Story | null>(null);
  const [script, setScript] = useState<RolePlayLine[]>([]);
  const [streak, setStreak] = useState(0);

  // Initialize streak logic
  useEffect(() => {
    const lastLogin = localStorage.getItem('lastLoginDate');
    const savedStreak = parseInt(localStorage.getItem('streak') || '0', 10);
    const today = new Date().toDateString();

    if (lastLogin !== today) {
      if (lastLogin) {
        // Logic to check if consecutive day could go here.
        // For simple gamification, we just increment.
        const newStreak = savedStreak + 1;
        setStreak(newStreak);
        localStorage.setItem('streak', newStreak.toString());
      } else {
        setStreak(1);
        localStorage.setItem('streak', '1');
      }
      localStorage.setItem('lastLoginDate', today);
    } else {
        setStreak(savedStreak);
    }
  }, []);

  const handleGenerateStory = async (characters: string[], words: string[], level: EnglishLevel) => {
    setMode(AppMode.LOADING);
    try {
      // 1. Generate Text
      const generatedStory = await GeminiService.generateStoryContent(characters, words, level);
      
      // 2. Generate Images for all pages in parallel
      const pagesWithImages = await Promise.all(generatedStory.pages.map(async (page) => {
          const imageUrl = await GeminiService.generateIllustration(page.imagePrompt);
          return { ...page, imageUrl };
      }));

      setStory({ ...generatedStory, pages: pagesWithImages });
      setMode(AppMode.READING);
    } catch (error) {
      console.error(error);
      alert("Failed to generate story. Please try again.");
      setMode(AppMode.SETUP);
    }
  };

  // Handles updates from Magic Edit (text) or Regenerate Image
  const handleUpdatePage = (pageIndex: number, updates: Partial<any>) => {
      if (!story) return;
      const newPages = [...story.pages];
      newPages[pageIndex] = { ...newPages[pageIndex], ...updates };
      setStory({ ...story, pages: newPages });
  };

  const handleStoryFinish = async () => {
    if (!story) return;
    setMode(AppMode.LOADING); // Use LOADING state while generating script
    try {
      const generatedScript = await GeminiService.generateRolePlayScript(story);
      setScript(generatedScript);
      setMode(AppMode.ACTING);
    } catch (error) {
      console.error(error);
      alert("Failed to generate script.");
      setMode(AppMode.READING);
    }
  };

  const handleScriptComplete = (recordedScript: RolePlayLine[]) => {
      setScript(recordedScript);
      setMode(AppMode.PLAYBACK);
  };

  const handleBackToStory = () => {
      setMode(AppMode.READING);
  };

  const resetApp = () => {
      setStory(null);
      setScript([]);
      setMode(AppMode.SETUP);
  };

  return (
    <AccessGate>
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 font-sans text-gray-800">
        
        {/* Header */}
        <header className="px-6 py-4 bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-gray-100">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2 cursor-pointer" onClick={resetApp}>
              <div className="bg-gradient-to-tr from-yellow-400 to-orange-500 text-white p-2 rounded-xl shadow-lg">
                  <Book size={24} fill="currentColor" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 hidden sm:block">
                StorySpark Kids
              </h1>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-bold shadow-sm border border-yellow-200">
                  <Star size={18} fill="currentColor" className="text-yellow-500"/>
                  <span>{streak} Days</span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full font-bold shadow-sm border border-indigo-200">
                  <Calendar size={18} />
                  <span>Today</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-4 py-8 md:py-12">
          {mode === AppMode.LOADING && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in">
              <div className="relative">
                  <div className="w-24 h-24 border-8 border-gray-200 rounded-full"></div>
                  <div className="w-24 h-24 border-8 border-indigo-500 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
              </div>
              <h2 className="mt-8 text-3xl font-bold text-indigo-800 animate-pulse">Creating Magic...</h2>
              <p className="text-gray-500 mt-2">Robots are drawing pictures & writing words!</p>
            </div>
          )}

          {mode === AppMode.SETUP && (
            <SetupForm 
              onGenerate={handleGenerateStory} 
              isGenerating={false} 
            />
          )}

          {mode === AppMode.READING && story && (
            <StoryReader 
              story={story} 
              onFinish={handleStoryFinish}
              onUpdatePage={handleUpdatePage}
            />
          )}

          {mode === AppMode.ACTING && story && (
            <ScriptRecorder 
              story={story}
              script={script} 
              onComplete={handleScriptComplete} 
              onBack={handleBackToStory}
            />
          )}

          {mode === AppMode.PLAYBACK && story && (
            <VideoPlayer 
              story={story} 
              script={script} 
              onReset={resetApp} 
            />
          )}
        </main>
      </div>
    </AccessGate>
  );
}

export default App;