import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import katex from "katex";
import { Equation } from "./components";
import {
  formulas,
  formulaPresentation,
  supplementaryFormulas,
} from "./formulas";

describe("readable mathematical presentation", () => {
  it("renders all multiline chapter and supplementary formulas with accessible MathML", () => {
    for (const tex of [...Object.values(formulas), ...supplementaryFormulas]) {
      const presentation = formulaPresentation(tex);
      const rendered = katex.renderToString(presentation.tex, {
        displayMode: true,
        throwOnError: true,
        output: "htmlAndMathml",
      });
      expect(rendered).toContain(
        '<math xmlns="http://www.w3.org/1998/Math/MathML"',
      );
      expect(rendered).not.toContain("katex-error");
      for (const { symbol } of presentation.symbols || []) {
        expect(() =>
          katex.renderToString(symbol, { throwOnError: true }),
        ).not.toThrow();
      }
    }
  });

  it("provides a named expansion action and a labeled scrollable math region", () => {
    const markup = renderToStaticMarkup(
      createElement(Equation, { tex: formulas.hamiltonian }),
    );
    expect(markup).toContain("Conditioned cost Hamiltonian");
    expect(markup).toContain(
      'aria-label="Expand formula: Conditioned cost Hamiltonian"',
    );
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('role="math"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain('role="dialog"');
  });

  it("retains custom labels and exact unfamiliar math rather than guessing its meaning", () => {
    const tex = String.raw`a^2+b^2=c^2`;
    expect(formulaPresentation(tex)).toEqual({ title: "Formula", tex });
    const markup = renderToStaticMarkup(
      createElement(Equation, { tex, label: "Custom equation" }),
    );
    expect(markup).toContain('aria-label="Expand formula: Custom equation"');
    expect(markup).toContain('aria-label="Custom equation"');
  });
});
