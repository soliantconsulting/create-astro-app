/**
 * Design tokens for the whole site, emitted as CSS custom properties on :root.
 *
 * Colors belong here and nowhere else. scripts/seo-check.ts fails the build on a color literal in a
 * stylesheet, a `<style>` block or a `style` attribute anywhere else; it does not read TypeScript,
 * so a React island must import these values (for its MUI theme too) rather than repeat them.
 */
export const tokens = {
    color: {
        brand: "#0e5a8a",
        brandDark: "#073c5e",
        ink: "#1f2933",
        inkMuted: "#52606d",
        surface: "#ffffff",
        surfaceAlt: "#f5f7fa",
        border: "#7b8794",
        focus: "#0b6d95",
        error: "#b42318",
    },
    font: {
        sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    size: {
        contentWidth: "72rem",
        readingWidth: "42rem",
        radius: "0.375rem",
    },
} as const;

const kebabCase = (name: string): string =>
    name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const tokenCss = (): string => {
    const declarations = Object.entries(tokens).flatMap(([group, values]) =>
        Object.entries(values).map(([name, value]) => `--${group}-${kebabCase(name)}: ${value};`),
    );

    return `:root { ${declarations.join(" ")} }`;
};
