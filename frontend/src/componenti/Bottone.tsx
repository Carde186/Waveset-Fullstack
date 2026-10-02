import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import stile from './Bottone.module.css';

type Variante = 'primario' | 'contorno';

const classi = (variante: Variante) => `${stile.bottone} ${stile[variante]}`;

interface ProprietaBottone extends ButtonHTMLAttributes<HTMLButtonElement> {
    variante?: Variante;
}

export function Bottone({ variante = 'primario', type = 'button', ...resto }: ProprietaBottone) {
    return <button type={type} className={classi(variante)} {...resto} />;
}

export function BottoneLink({
    variante = 'primario',
    ...resto
}: LinkProps & { variante?: Variante }) {
    return <Link className={classi(variante)} {...resto} />;
}
