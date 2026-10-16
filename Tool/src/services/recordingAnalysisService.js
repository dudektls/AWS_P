export class RecordingAnalysisService {
  constructor({
    transcriptionService,
    summaryService,
    audioSplitter,
    chunkMinutes = 50,
  }) {
    this.transcriptionService = transcriptionService;
    this.summaryService = summaryService;
    this.audioSplitter = audioSplitter;
    this.chunkThresholdSeconds = chunkMinutes * 60;
  }

  async analyze({ filePath, mimeType, durationSeconds, onProgress = () => {} }) {
    let transcript;
    let chunkCount = 1;

    if (durationSeconds <= this.chunkThresholdSeconds) {
      onProgress({
        phase: "transcribing",
        completedChunks: 0,
        totalChunks: 1,
      });
      transcript = await this.transcriptionService.transcribe({
        filePath,
        mimeType,
      });
      onProgress({
        phase: "transcribing",
        completedChunks: 1,
        totalChunks: 1,
      });
    } else {
      onProgress({ phase: "splitting" });
      const splitResult = await this.audioSplitter.split(filePath);
      chunkCount = splitResult.files.length;
      try {
        const transcripts = [];
        onProgress({
          phase: "transcribing",
          completedChunks: 0,
          totalChunks: chunkCount,
        });
        for (const [index, chunkPath] of splitResult.files.entries()) {
          transcripts.push(
            await this.transcriptionService.transcribe({
              filePath: chunkPath,
              mimeType: "audio/mpeg",
            }),
          );
          onProgress({
            phase: "transcribing",
            completedChunks: index + 1,
            totalChunks: chunkCount,
          });
        }
        transcript = transcripts.join("\n\n");
      } finally {
        await splitResult.cleanup();
      }
    }

    onProgress({ phase: "summarizing" });
    const summary = await this.summaryService.summarize(transcript);
    return { transcript, summary, chunkCount };
  }
}
