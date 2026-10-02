import { useId, type InputHTMLAttributes } from 'react';
import stile from './CampoTesto.module.css';

interface ProprietaCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
    etichetta: string;
    errore?: string | null;
    suggerimento?: string;
}

// Campo di testo con etichetta, suggerimento ed errore collegati per accessibilità.
// L'errore non si affida al solo colore: ha un testo, un bordo più marcato e
// aria-invalid.
export function CampoTesto({ etichetta, errore, suggerimento, ...resto }: ProprietaCampo) {
    const id = useId();
    const idSuggerimento = `${id}-suggerimento`;
    const idErrore = `${id}-errore`;
    const descrizione =
        [suggerimento ? idSuggerimento : null, errore ? idErrore : null]
            .filter(Boolean)
            .join(' ') || undefined;

    return (
        <div className={`${stile.campo} ${errore ? stile.invalido : ''}`}>
            <label className={stile.etichetta} htmlFor={id}>
                {etichetta}
            </label>
            <div className={stile.scatola}>
                <input
                    id={id}
                    aria-invalid={errore ? true : undefined}
                    aria-describedby={descrizione}
                    {...resto}
                />
            </div>
            {suggerimento ? (
                <p id={idSuggerimento} className={stile.suggerimento}>
                    {suggerimento}
                </p>
            ) : null}
            {errore ? (
                <p id={idErrore} className={stile.errore}>
                    {errore}
                </p>
            ) : null}
        </div>
    );
}
