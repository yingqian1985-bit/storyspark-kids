import { GoogleGenAI, Type, Schema } from "@google/genai";
import { EnglishLevel, Story, RolePlayLine } from "../types";

// Dynamic Gemini Client Instance - REMOVE
// Coding Guideline: Use process.env.API_KEY directly
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates the story text structure using Gemini 2.5 Flash.
 */
export const generateStoryContent = async (
  characters: string[],
  words: string[],
  level: EnglishLevel
): Promise<Story> => {
  const model = "gemini-2.5-flash";

  const systemInstruction = `
    You are a world-class children's book author. 
    Create a captivating, educational, and fun story for children.
    The story must incorporate the provided characters and vocabulary words.
    Adjust the complexity based on the provided English Level.
    Ensure the story has a clear beginning, middle, and end, approx 5-8 pages.
    The content must be safe, positive, and encouraging.
    IMPORTANT: Generate a title that is SHORT (max 6 words), FUN, and ATTRACTIVE to kids. It should spark curiosity immediately.
  `;

  const prompt = `
    Characters: ${characters.join(", ")}
    Target Vocabulary Words: ${words.join(", ")}
    English Level: ${level}
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { 
        type: Type.STRING, 
        description: "A very short, catchy, and exciting title for kids (e.g., 'The Magic Rabbit', 'Robot's Big Adventure'). Max 6 words." 
      },
      pages: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            pageNumber: { type: Type.INTEGER },
            text: { type: Type.STRING, description: "The story text for this page" },
            imagePrompt: { type: Type.STRING, description: "A detailed visual description to generate an illustration for this page. Cute, colorful, children's book style." }
          },
          required: ["pageNumber", "text", "imagePrompt"]
        }
      }
    },
    required: ["title", "pages"]
  };

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
    },
  });

  if (!response.text) {
    throw new Error("Failed to generate story text");
  }

  const data = JSON.parse(response.text);
  
  return {
    ...data,
    characters,
    vocabulary: words,
    level,
  };
};

/**
 * Generates an image for a specific page using Gemini 2.5 Flash Image.
 */
export const generateIllustration = async (prompt: string): Promise<string> => {
  const model = "gemini-2.5-flash-image";
  
  // Enhance prompt for consistency
  const enhancedPrompt = `A high-quality, colorful children's book illustration. Digital art style, cute, vibrant colors. Scene: ${prompt}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{
        parts: [{ text: enhancedPrompt }]
      }],
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    // Check for inline data (image)
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    
    // Fallback if no image found in response
    return `https://picsum.photos/800/600?random=${Math.random()}`;

  } catch (error: any) {
    console.error("Image generation failed:", error);
    
    // Handle Quota (429) and RPC (500) errors gracefully by returning a placeholder
    if (error.status === 429 || error.code === 429 || error.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn("Quota exceeded for image generation. Using placeholder.");
    }
    
    return `https://picsum.photos/800/600?random=${Math.random()}`;
  }
};

/**
 * Regenerates an illustration based on the original prompt and user feedback.
 */
export const regenerateIllustration = async (
  originalPrompt: string,
  feedback: { type: 'TEXT' | 'AUDIO', content: string, mimeType?: string }
): Promise<string> => {
  const model = "gemini-2.5-flash";
  
  const systemInstruction = `You are an art director for a children's book. 
  Your goal is to refine an image prompt based on feedback.
  Return ONLY the new prompt string.`;

  const promptText = `
    Original Image Prompt: "${originalPrompt}"
    
    Instruction: Update the original prompt according to the feedback. 
    If feedback is audio, listen and translate if needed.
    Keep the style consistent (children's book illustration, cute, colorful).
  `;

  const parts: any[] = [{ text: promptText }];

  if (feedback.type === 'AUDIO') {
    parts.push({
      inlineData: {
        mimeType: feedback.mimeType || 'audio/webm',
        data: feedback.content
      }
    });
  } else {
    parts.push({ text: `Feedback: ${feedback.content}` });
  }

  let newPrompt = originalPrompt;

  try {
    // 1. Get refined prompt
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: { systemInstruction }
    });
    
    newPrompt = response.text?.trim() || originalPrompt;
    console.log("Refined prompt:", newPrompt);

  } catch (error: any) {
    console.error("Prompt refinement failed:", error);
    // If text refinement fails (e.g. quota), we proceed with the original prompt
    if (error.message === 'QUOTA_EXCEEDED' || error.status === 429) {
        // We can't do much if quota is out, but we let generateIllustration handle the image part
    }
  }

  // 2. Generate new image (using the potentially refined prompt)
  return await generateIllustration(newPrompt);
};

/**
 * Converts a story into a role-play script.
 */
export const generateRolePlayScript = async (story: Story): Promise<RolePlayLine[]> => {
  const model = "gemini-2.5-flash";

  // We map the story pages to include their index so the model can reference them
  const storyContent = story.pages.map((p, idx) => ({
    pageIndex: idx,
    text: p.text
  }));
  
  const prompt = `
    Convert the following children's story into a short play script for kids to act out.
    Characters: ${story.characters.join(", ")}.
    
    Story Content (Page by Page):
    ${JSON.stringify(storyContent)}
    
    Instruction:
    Create dialogue lines for each page.
    IMPORTANT: You MUST indicate which 'pageIndex' (0-based integer) each line belongs to.
    Keep lines simple, fun, and easy for kids to say.
    
    Format: JSON Array of objects with 'id', 'pageIndex', 'character', and 'text'.
  `;

  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        pageIndex: { type: Type.INTEGER, description: "The index of the story page this dialogue belongs to." },
        character: { type: Type.STRING },
        text: { type: Type.STRING }
      },
      required: ["id", "pageIndex", "character", "text"]
    }
  };

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema,
    }
  });

  if (!response.text) {
    throw new Error("Failed to generate script");
  }

  return JSON.parse(response.text);
};

/**
 * Regenerates the script for a specific page based on user feedback.
 */
export const regenerateScriptForPage = async (
  currentLines: RolePlayLine[],
  feedback: { type: 'TEXT' | 'AUDIO', content: string, mimeType?: string },
  storyContext: string,
  pageIndex: number,
  characters: string[]
): Promise<RolePlayLine[]> => {
  const model = "gemini-2.5-flash";

  const systemInstruction = `You are a creative drama teacher for kids. 
  Your goal is to rewrite the dialogue for a specific scene in a school play based on feedback.
  Keep the characters consistent.
  Return the new list of dialogue lines for this scene.`;

  const promptText = `
    Current Dialogue: ${JSON.stringify(currentLines.map(l => ({ character: l.character, text: l.text })))}
    Scene Context (Story Text): "${storyContext}"
    Available Characters: ${characters.join(', ')}
    
    Instruction: Rewrite the dialogue for this scene according to the feedback. 
    If feedback is audio, listen to it (translate if needed) and apply the changes (e.g., "Make it funnier", "Add a line for Rabbit").
    Return a JSON array of objects with 'id', 'pageIndex' (must be ${pageIndex}), 'character', and 'text'.
  `;

  const parts: any[] = [{ text: promptText }];

  if (feedback.type === 'AUDIO') {
    parts.push({
      inlineData: {
        mimeType: feedback.mimeType || 'audio/webm',
        data: feedback.content
      }
    });
  } else {
    parts.push({ text: `Feedback: ${feedback.content}` });
  }

  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        pageIndex: { type: Type.INTEGER },
        character: { type: Type.STRING },
        text: { type: Type.STRING }
      },
      required: ["id", "pageIndex", "character", "text"]
    }
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: { 
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    if (!response.text) return currentLines;
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Script regeneration failed:", error);
    throw error;
  }
};

/**
 * Extracts characters or words from audio input using Gemini.
 */
export const extractInputsFromAudio = async (
  audioBase64: string, 
  mimeType: string, 
  type: 'CHARACTERS' | 'WORDS'
): Promise<string[]> => {
  const model = "gemini-2.5-flash";
  
  const prompt = type === 'CHARACTERS' 
    ? "Listen to the child's voice listing characters. Extract names as a JSON array of English strings. If spoken in Chinese or other languages, TRANSLATE IT TO ENGLISH. E.g., '兔子和机器人' -> [\"Rabbit\", \"Robot\"]. Ignore filler words. Return just the JSON array."
    : "Listen to the child's voice listing words. Extract words as a JSON array of English strings. If spoken in Chinese or other languages, TRANSLATE IT TO ENGLISH. E.g., '阳光' -> [\"Sunshine\"]. Ignore filler words. Return just the JSON array.";

  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: { type: Type.STRING }
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: prompt }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.4,
      }
    });

    if (!response.text) return [];
    return JSON.parse(response.text);
  } catch (error: any) {
    console.error("Audio extraction failed:", error);
    if (error.status === 429 || error.code === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
      throw new Error("QUOTA_EXCEEDED");
    }
    return [];
  }
};

/**
 * Regenerates the text for a specific page based on user feedback.
 */
export const regeneratePageContent = async (
  currentText: string,
  feedback: { type: 'TEXT' | 'AUDIO', content: string, mimeType?: string },
  storyContext: string
): Promise<string> => {
  const model = "gemini-2.5-flash";
  
  const systemInstruction = `You are a helpful and creative editor for children's stories. 
  Your goal is to modify a specific page's text based on the child's feedback. 
  Maintain the tone, vocabulary level, and character consistency.
  Return ONLY the new text for the page.`;

  const promptText = `
    Original Page Text: "${currentText}"
    Full Story Context (for reference): ${storyContext}
    
    Instruction: Rewrite the 'Original Page Text' according to the feedback. 
    If the feedback is audio, listen to what the child wants to change (e.g., "make it funnier", "add a dragon", "he should be sad").
    Translate the audio feedback to English if it is in another language before applying the change.
  `;

  const parts: any[] = [{ text: promptText }];

  if (feedback.type === 'AUDIO') {
    parts.push({
      inlineData: {
        mimeType: feedback.mimeType || 'audio/webm',
        data: feedback.content
      }
    });
  } else {
    parts.push({ text: `Feedback: ${feedback.content}` });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: { systemInstruction }
    });

    return response.text?.trim() || currentText;
  } catch (error) {
    console.error("Regeneration failed:", error);
    throw error;
  }
};

export const getStoryTranslation = async (story: Story): Promise<{
  title: string;
  characters: string[];
  vocabulary: string[];
  pages: string[];
}> => {
  const model = "gemini-2.5-flash";
  
  const contentToTranslate = {
    title: story.title,
    characters: story.characters,
    vocabulary: story.vocabulary,
    pages: story.pages.map(p => p.text)
  };

  const prompt = `
    You are a professional translator for children's books.
    Translate the following JSON content into Simplified Chinese (Mandarin) for children.
    Keep the tone fun and appropriate.
    
    Input JSON:
    ${JSON.stringify(contentToTranslate)}

    Output must be a JSON object with the exact same structure, containing the Chinese translations.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      characters: { type: Type.ARRAY, items: { type: Type.STRING } },
      vocabulary: { type: Type.ARRAY, items: { type: Type.STRING } },
      pages: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["title", "characters", "vocabulary", "pages"]
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.5,
      }
    });

    if (!response.text) {
      throw new Error("Translation failed");
    }
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Translation failed:", error);
    return {
      title: story.title,
      characters: story.characters,
      vocabulary: story.vocabulary,
      pages: story.pages.map(p => p.text)
    };
  }
};

export const getScriptTranslation = async (script: RolePlayLine[]): Promise<Record<string, string>> => {
  const model = "gemini-2.5-flash";
  
  const contentToTranslate = script.map(line => ({
    id: line.id,
    text: line.text
  }));

  const prompt = `
    Translate the following dialogue lines into Simplified Chinese (Mandarin) for a children's play.
    Keep the tone conversational and appropriate for kids.
    
    Input JSON:
    ${JSON.stringify(contentToTranslate)}

    Output: JSON Object where Keys are the 'id' and Values are the 'chineseText'.
  `;

  const arrayResponseSchema: Schema = {
      type: Type.ARRAY,
      items: {
          type: Type.OBJECT,
          properties: {
              id: { type: Type.STRING },
              chineseText: { type: Type.STRING }
          },
          required: ["id", "chineseText"]
      }
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: arrayResponseSchema,
        temperature: 0.5,
      }
    });

    if (!response.text) return {};
    
    const translatedArray = JSON.parse(response.text) as Array<{id: string, chineseText: string}>;
    const translationMap: Record<string, string> = {};
    translatedArray.forEach(item => {
        translationMap[item.id] = item.chineseText;
    });
    
    return translationMap;

  } catch (error) {
    console.error("Script translation failed:", error);
    return {};
  }
};

export const generateSpeech = async (text: string, voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Puck'): Promise<string | null> => {
  if (!text || text.trim().length === 0) return null;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ 
        parts: [{ text }] 
      }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    const pcmData = base64ToUint8Array(base64Audio);
    const wavBlob = pcmToWav(pcmData);
    return URL.createObjectURL(wavBlob);

  } catch (error) {
    console.error("TTS generation failed:", error);
    return null;
  }
};

// --- Audio Helper Functions (Unchanged) ---
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function pcmToWav(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const totalDataLen = pcmData.length;
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + totalDataLen, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true); 
  view.setUint16(22, 1, true); 
  view.setUint32(24, sampleRate, true); 
  view.setUint32(28, sampleRate * 2, true); 
  view.setUint16(32, 2, true); 
  view.setUint16(34, 16, true); 
  writeString(view, 36, 'data');
  view.setUint32(40, totalDataLen, true);
  return new Blob([header, pcmData], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}