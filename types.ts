export enum EnglishLevel {
  BEGINNER = 'Beginner (Ages 3-4, Simple words)',
  INTERMEDIATE = 'Intermediate (Ages 5-6, Simple sentences)',
  ADVANCED = 'Advanced (Ages 7-8, Complex narrative)',
}

export interface StoryPage {
  pageNumber: number;
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  audioUrl?: string; // For user recording
}

export interface Story {
  title: string;
  pages: StoryPage[];
  characters: string[];
  vocabulary: string[];
  level: EnglishLevel;
}

export interface RolePlayLine {
  id: string;
  pageIndex: number; // Link to specific story page/scene
  character: string;
  text: string;
  audioUrl?: string;
}

export enum AppMode {
  SETUP = 'SETUP',
  LOADING = 'LOADING',
  READING = 'READING',
  ACTING = 'ACTING',
  PLAYBACK = 'PLAYBACK',
}

export interface UserProgress {
  streak: number;
  lastLoginDate: string;
  storiesCreated: number;
}
