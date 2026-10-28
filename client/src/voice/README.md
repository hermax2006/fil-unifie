# voice/

Widget vocal à venir : micro (MediaRecorder) → serveur → Whisper (Groq) → IA → lecture vocale.
On utilise MediaRecorder plutôt que webkitSpeechRecognition, peu fiable sur Safari iOS.
