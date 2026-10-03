import { impostaLingua, t, useLingua } from '../localizzazione/lingua';
import stile from './Intestazione.module.css';

export function SelettoreLingua() {
    const lingua = useLingua();
    return (
        <label className={stile.lingua}>
            <span>{t('language.label')}</span>
            <select
                value={lingua}
                onChange={(e) => impostaLingua(e.target.value === 'en' ? 'en' : 'it')}
            >
                <option value="it">{t('language.it')}</option>
                <option value="en">{t('language.en')}</option>
            </select>
        </label>
    );
}
