import { redirect } from "next/navigation";

// The app is mobile-first and the editor is the home screen.
// Anyone landing on "/" is sent straight there; auth redirects to /login if needed.
export default function Home() {
  redirect("/editor");
}
