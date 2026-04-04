import whisper
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Fehler: Kein Audio-Pfad angegeben.", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "tiny"

    lang = os.environ.get("WHISPER_LANG", "de")
    language = None if lang == "auto" else lang

    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, language=language)
    print(result["text"].strip())

if __name__ == "__main__":
    main()
