import { useRef, useState } from 'react';
import { desktopClient } from '../../../bridge/desktopClient.ts';

const CHUNK_BYTES = 192 * 1024;

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function stageFile(file, onProgress, isCurrent) {
  const { id } = await desktopClient.request('command.agent.files.begin', { name: file.name, bytes: file.size });
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (!isCurrent()) {
        await desktopClient.request('command.agent.files.discard', { ids: [id] });
        return null;
      }
      const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      await desktopClient.request('command.agent.files.chunk', { id, offset, data: base64(chunk) });
      onProgress?.({ name: file.name, percent: Math.round(Math.min(100, (offset + chunk.length) / file.size * 100)) });
    }
    if (!isCurrent()) {
      await desktopClient.request('command.agent.files.discard', { ids: [id] });
      return null;
    }
    return await desktopClient.request('command.agent.files.finish', { id });
  } catch (error) {
    await desktopClient.request('command.agent.files.discard', { ids: [id] }).catch(() => {});
    throw error;
  }
}

export function useChatInputFiles() {
  const [inputFiles, setInputFiles] = useState([]);
  const [filesUploading, setFilesUploading] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(null);
  const inputFilesRef = useRef([]);
  const pendingUploadsRef = useRef(0);
  const generationRef = useRef(0);

  async function addInputFiles(files) {
    if (!files?.length) return;
    const generation = generationRef.current;
    pendingUploadsRef.current += 1;
    setFilesUploading(true);
    try {
      for (const file of files) {
        if (generation !== generationRef.current) return;
        setFileUploadProgress({ name: file.name, percent: 0 });
        const staged = await stageFile(file, (progress) => {
          if (generation === generationRef.current) setFileUploadProgress(progress);
        }, () => generation === generationRef.current);
        if (!staged) return;
        if (generation !== generationRef.current) {
          await desktopClient.request('command.agent.files.discard', { ids: [staged.id] });
          return;
        }
        inputFilesRef.current = [...inputFilesRef.current, staged];
        setInputFiles(inputFilesRef.current);
      }
    } finally {
      pendingUploadsRef.current -= 1;
      setFilesUploading(pendingUploadsRef.current > 0);
      if (pendingUploadsRef.current === 0) setFileUploadProgress(null);
    }
  }

  async function removeInputFile(id) {
    inputFilesRef.current = inputFilesRef.current.filter((item) => item.id !== id);
    setInputFiles(inputFilesRef.current);
    await desktopClient.request('command.agent.files.discard', { ids: [id] });
  }

  function clearInputFiles() {
    inputFilesRef.current = [];
    setInputFiles([]);
  }

  function discardInputFiles() {
    generationRef.current += 1;
    const ids = inputFilesRef.current.map((file) => file.id);
    clearInputFiles();
    setFileUploadProgress(null);
    if (ids.length) void desktopClient.request('command.agent.files.discard', { ids }).catch(() => {});
  }

  return { inputFiles, inputFilesRef, filesUploading, fileUploadProgress, addInputFiles, removeInputFile, clearInputFiles, discardInputFiles };
}
