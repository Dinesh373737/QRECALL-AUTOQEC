import { createRoot } from "react-dom/client";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles.css";
// The original QRecall associative-memory laboratory, preserved unchanged.
createRoot(document.getElementById("root")!).render(<App />);
