import type { ThemeSnapshot, Translate } from './market-data.ts';
export interface MarketSectionProps {
    t: Translate;
    locale: {
        subscribe(callback: () => void): () => void;
        getSnapshot(): {
            active: string;
        };
    };
    theme: {
        setTheme(id: string): void;
    };
    themeStore: {
        subscribe(callback: () => void): () => void;
        getSnapshot(): ThemeSnapshot | null;
    };
}
export declare function MarketSection(props: MarketSectionProps): any;
