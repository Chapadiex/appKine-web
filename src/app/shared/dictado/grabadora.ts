/**
 * Graba audio del micrófono con `MediaRecorder`.
 *
 * <p>El formato lo decide el navegador: Chrome graba `audio/webm;codecs=opus` y Safari `audio/mp4`.
 * El servidor acepta los dos. El micrófono sólo existe en un contexto seguro (HTTPS o `localhost`):
 * una tablet que entra por `http://192.168.x.x` no tiene `getUserMedia`, y entonces no se ofrece
 * dictar.
 */
export class Grabadora {
  private static readonly FORMATOS = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
  ];

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private partes: Blob[] = [];

  /** Si este navegador, en esta página, puede grabar. */
  static disponible(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /** Pide el micrófono (la primera vez el navegador pregunta) y empieza a grabar. */
  async empezar(): Promise<void> {
    this.cancelar();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const formato = Grabadora.FORMATOS.find((f) => MediaRecorder.isTypeSupported(f));
    this.recorder = new MediaRecorder(this.stream, formato ? { mimeType: formato } : undefined);
    this.partes = [];
    this.recorder.ondataavailable = (evento) => {
      if (evento.data.size > 0) {
        this.partes.push(evento.data);
      }
    };
    this.recorder.start();
  }

  /** Termina y devuelve lo grabado. Suelta el micrófono. */
  detener(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.soltar();
      return Promise.resolve(new Blob([]));
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const tipo = recorder.mimeType || this.partes[0]?.type || 'audio/webm';
        const audio = new Blob(this.partes, { type: tipo });
        this.soltar();
        resolve(audio);
      };
      recorder.stop();
    });
  }

  /** Descarta lo grabado y suelta el micrófono. */
  cancelar(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.soltar();
  }

  private soltar(): void {
    this.stream?.getTracks().forEach((pista) => pista.stop());
    this.stream = null;
    this.recorder = null;
    this.partes = [];
  }
}
