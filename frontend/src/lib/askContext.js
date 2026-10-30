import { createContext } from "react";

// askAbout(context, question): open the Ask tab with a context chip and a
// suggested question. context = { type, id, label }.
export const AskContext = createContext(() => {});
