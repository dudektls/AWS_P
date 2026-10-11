# AI 학습 도구 MVP

대학교 시간표 이미지를 Gemini로 분석해 수정 가능한 웹 시간표로 저장하고 가용시간을 계산하며, 녹음 파일의 전체 스크립트와 요약문도 생성하는 Node.js MVP입니다.

## 실행 환경

- Windows 10/11
- Node.js 20 이상
- Google AI Studio에서 발급한 Gemini API 키

## 실행 방법

AntiGravity IDE 터미널에서 다음 명령을 실행합니다.

```powershell
npm.cmd install
npm.cmd start
```

브라우저에서 시간표 분석은 `http://localhost:3000/timetable.html`, 녹음 변환은 `http://localhost:3000`을 엽니다. 기존 서버가 실행 중이라면 `Ctrl+C`로 종료한 다음 다시 시작해야 변경된 설정이 적용됩니다.

## `.env` 설정

실행에 필요한 실제 설정은 `.env`에 작성합니다. `.env.example`은 팀원에게 공유할 수 있는 견본이며 실제 API 키를 넣지 않습니다.

```dotenv
GEMINI_API_KEY=실제_API_키
PORT=3000
MAX_UPLOAD_MB=500
MAX_AUDIO_DURATION_MINUTES=120
TRANSCRIPTION_CHUNK_MINUTES=50
GEMINI_TIMEOUT_MS=300000
GEMINI_SUMMARY_MODEL=gemini-3.8-flash
MAX_IMAGE_UPLOAD_MB=10
GEMINI_TIMETABLE_MODEL=gemini-3.8-flash
TIMETABLE_START_HOUR=8
TIMETABLE_END_HOUR=22
```

- `MAX_UPLOAD_MB`: 서버가 받을 수 있는 파일의 최대 용량입니다.
- `MAX_AUDIO_DURATION_MINUTES`: 전체 녹음 길이 제한이며 최대 120분으로 검증합니다.
- `TRANSCRIPTION_CHUNK_MINUTES`: Gemini의 파일당 1시간 제한을 피하기 위한 분할 길이입니다. 안전 여유를 두고 50분을 사용합니다.
- `GEMINI_TIMEOUT_MS`: 각 Gemini 요청을 기다리는 최대 시간입니다.
- `GEMINI_SUMMARY_MODEL`: 전체 전사문을 요약할 텍스트 모델입니다.
- `MAX_IMAGE_UPLOAD_MB`: 시간표 이미지의 최대 업로드 용량입니다. 최대 20MB로 제한합니다.
- `GEMINI_TIMETABLE_MODEL`: 이미지 이해와 구조화 출력을 수행할 모델입니다.
- `TIMETABLE_START_HOUR`, `TIMETABLE_END_HOUR`: 웹 시간표의 표시 범위입니다.

## 시간표 이미지 처리 흐름

1. 브라우저와 Multer가 PNG/JPG/JPEG 확장자, MIME, 빈 파일, 10MB 제한을 확인합니다.
2. 서버가 PNG 청크·CRC 또는 JPEG 마커와 이미지 크기를 검사하여 손상 파일을 거부합니다.
3. 이미지를 base64로 읽어 `gemini-3.8-flash` Interactions API에 인라인 이미지로 전달합니다.
4. `response_format`에 JSON Schema를 지정해 수업 배열과 경고 배열을 구조화된 JSON으로 받습니다.
5. 서버가 요일, HH:mm 시간, 시작·종료 순서, 중복, 시간 충돌, 필수 값을 다시 검증하고 UUID를 부여합니다.
6. 브라우저가 월~금 시간표에 분 단위 비율로 수업을 배치하며, 겹치는 수업은 나란히 표시합니다.
7. 사용자가 수업을 수정·추가·삭제한 뒤 `확인 및 저장`을 눌러 확정본을 localStorage에 저장합니다.
8. 공부 가능 범위에서 수업과 개인 일정을 병합해 제외하고, 스터디 매칭용 `availableSlots` 데이터를 만듭니다.
9. 성공 또는 실패 후 서버의 임시 이미지 파일을 삭제합니다.

## 처리 흐름

1. 브라우저가 확장자, 빈 파일, 용량을 먼저 확인하고 미리듣기를 제공합니다.
2. Multer가 파일을 UUID 이름으로 `uploads/`에 임시 저장합니다.
3. 서버가 확장자와 MIME을 함께 검사하고 `music-metadata`로 실제 오디오와 재생 시간을 확인합니다.
4. 50분 이하는 원본 파일을 바로 전사합니다.
5. 50분 초과 파일은 FFmpeg가 약 50분 길이의 96kbps MP3 조각으로 변환합니다.
6. 각 조각을 순서대로 `gemini-3.5-transcribe`에 보내고 결과를 원래 순서대로 합칩니다.
7. Interactions API에는 `ko-KR`, verbatim 모드를 적용합니다. 해당 엔드포인트가 404를 반환하면 같은 전사 모델의 Generate Content API로 자동 전환합니다.
8. 합쳐진 전체 스크립트를 `gemini-3.8-flash`에 보내 학습용 요약문을 생성합니다.
9. 업로드 중에는 실제 전송 바이트 비율을, 전사 중에는 완료된 오디오 조각 비율과 예상 잔여 시간을 표시합니다.
10. 전체 스크립트와 요약문을 각각 수정 가능하고 내부 스크롤이 가능한 textarea에 표시합니다.
11. 각 결과의 `크게 보기` 버튼을 누르면 화면 대부분을 사용하는 편집 창이 열리며, 수정 내용은 원래 textarea와 동기화됩니다.
12. 처리 성공·실패와 관계없이 로컬 원본, 분할 파일, Gemini 원격 파일을 삭제합니다.

## 주요 파일

- `src/app.js`: API 경로, 오디오 검사, 120분 제한, 오류 응답과 원본 파일 정리를 담당합니다.
- `src/services/transcriptionService.js`: Files API 업로드와 Gemini 3.5 Transcribe 호출을 담당합니다.
- `src/services/audioSplitter.js`: FFmpeg를 안전한 인자 배열로 실행하여 긴 녹음을 MP3 조각으로 분할합니다.
- `src/services/recordingAnalysisService.js`: 분할 여부 판단, 조각 순차 전사, 스크립트 병합, 요약 호출을 조정합니다.
- `src/services/summaryService.js`: 전체 전사문을 Gemini 3.8 Flash로 요약합니다.
- `src/middleware/upload.js`: MP3, WAV, M4A 확장자·MIME과 업로드 용량을 검증합니다.
- `src/services/timetableImageService.js`: 이미지 입력, Gemini Interactions API, JSON Schema 요청과 오류 구분을 담당합니다.
- `src/services/timetableValidationService.js`: AI 결과의 요일·시간·중복·충돌을 런타임에 검증합니다.
- `src/services/imageValidationService.js`: PNG/JPEG 파일 구조와 이미지 크기를 검증합니다.
- `public/index.html`: 업로드, 전체 스크립트, 요약문 화면 구조입니다.
- `public/app.js`: 드래그 앤 드롭, 미리듣기, 중복 제출 방지, 두 결과 출력과 복사를 처리합니다.
- `public/timetable.html`, `public/timetable.js`, `public/timetable.css`: 시간표 업로드, 편집, 시각화와 반응형 화면입니다.
- `public/availability.js`: 시간 구간 병합과 차집합으로 가용시간을 계산합니다.
- `public/timetableStorage.js`: 확정 시간표의 localStorage 저장·복원 경계를 제공합니다.
- `test/app.test.js`: 업로드, 오류, 분할, 병합, 요약 요청과 임시 파일 정리를 검증합니다.

## 사용 라이브러리

- `@google/genai`: Google 공식 Gemini JavaScript SDK입니다.
- `express`: 정적 화면과 API 서버를 제공합니다.
- `multer`: 대용량 multipart 파일을 메모리가 아닌 디스크로 받습니다.
- `music-metadata`: 실제 오디오 형식과 길이를 읽습니다.
- `ffmpeg-static`: 별도 FFmpeg 설치 없이 Windows에서 긴 오디오를 분할합니다.
- `dotenv`: API 키와 서버 설정을 `.env`에서 읽습니다.

## 테스트

```powershell
npm.cmd test
```

자동 테스트는 다음을 확인합니다.

- 정적 웹페이지와 공개 설정
- WAV 실제 컨테이너 처리와 임시 파일 삭제
- MP3·M4A MIME 전달
- 잘못된 파일과 손상 오디오 거부
- API 키 누락 처리
- Gemini 한국어 verbatim 요청과 원격 파일 삭제
- Interactions API 404 시 대체 경로
- 2시간 녹음의 다중 조각 전사·병합·요약 흐름
- 실제 FFmpeg MP3 분할 결과
- Gemini 3.8 Flash 요약 요청
- 120분 초과 파일 거부
- PNG/JPEG 시간표 업로드와 임시 파일 삭제
- 지원하지 않는 이미지, 손상 PNG, 10MB 초과 거부
- Gemini 이미지 입력과 JSON Schema 요청
- API 키 누락과 모델 접근 불가 오류 구분
- 불확실한 값, 중복 수업, 시간 충돌 검증
- 겹친 수업·개인 일정을 제외한 가용시간 계산
- 확정 시간표 저장·복원

## 제한사항

- Gemini Transcribe의 요청당 공식 제한은 1시간이므로 이 프로젝트가 자체적으로 파일을 분할합니다.
- 500MB는 일반적인 MP3·M4A 강의 녹음에는 충분하지만, 무압축 고음질 WAV 2시간 파일은 500MB를 넘을 수 있습니다. 필요하면 디스크 공간을 확인한 뒤 `MAX_UPLOAD_MB`를 높이세요.
- 여러 조각을 순차 처리하므로 2시간 녹음은 짧은 파일보다 처리 시간이 오래 걸리고 API 호출 횟수도 증가합니다.
- 분할 경계에서 한 문장이 아주 짧게 끊길 수 있습니다. 현재는 조각 간 중첩과 중복 문장 제거를 하지 않습니다.
- 장시간 처리를 하나의 HTTP 요청에서 수행하므로 AWS 배포 시 로드 밸런서 제한을 고려해 작업 큐 방식으로 바꾸는 것이 좋습니다.
- Gemini API는 처리 퍼센트나 예상 완료 시간을 제공하지 않습니다. 전사 잔여 시간은 완료된 조각의 평균 처리 시간으로 계산한 참고값이며, 분할 및 요약 시간은 포함하지 않습니다.
- 요약은 반복과 군더더기를 제거하고 일반적으로 8~12개 핵심 항목으로 정리하도록 요청하지만, 실제 길이와 표현은 Gemini 응답에 따라 조금 달라질 수 있습니다.
- 시간표 확정본은 현재 브라우저의 localStorage에만 저장됩니다. 다른 브라우저·기기와 동기화되지 않으며 로그인/MySQL 연동 시 `timetableStorage.js`를 서버 API 구현으로 교체해야 합니다.
- 교시만 있고 실제 시각 정보가 없는 이미지는 학교별 교시표 없이는 자동 확정할 수 없어 `검토 필요`로 표시합니다.
- 토·일 데이터는 내부 구조와 편집 목록에서 지원하지만 현재 시각화와 가용시간 화면은 월~금 중심입니다.
- 실제 스터디 검색·매칭, 로그인, MySQL, DOCX, AWS 배포, MCP는 포함하지 않습니다.

공식 문서: [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Audio transcription](https://ai.google.dev/gemini-api/docs/transcribe), [API 키](https://ai.google.dev/gemini-api/docs/api-key)
