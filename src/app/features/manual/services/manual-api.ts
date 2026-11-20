import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ManualService } from '../../../api/generated/api/manual.service';
import { FichaDelManualResponse } from '../../../api/generated/model/ficha-del-manual-response';
import { IndiceDelManualResponse } from '../../../api/generated/model/indice-del-manual-response';
import { PasajeDelManualResponse } from '../../../api/generated/model/pasaje-del-manual-response';

/** El manual de usuario por la API (appKine-api, `/api/v1/manual`). */
@Injectable({ providedIn: 'root' })
export class ManualApi {
  private readonly api = inject(ManualService);

  indice(): Observable<IndiceDelManualResponse> {
    return this.api.verIndiceDelManual();
  }

  ficha(id: string): Observable<FichaDelManualResponse> {
    return this.api.verFichaDelManual({ id });
  }

  /** La ficha de la pantalla, o `null` si no tiene (204). */
  deLaRuta(ruta: string): Observable<FichaDelManualResponse | null> {
    return this.api.verFichaDeLaRuta({ ruta }, 'response').pipe(map((r) => r.body ?? null));
  }

  buscar(q: string, ruta: string): Observable<PasajeDelManualResponse[]> {
    return this.api.buscarEnElManual({ q, ruta });
  }
}
