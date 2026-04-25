import AppShellClient from "./components/AppShellClient";

export const metadata = {
  title: "NEXT Ventures Audit Tool",
  description: "Internal audit system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShellClient>{children}</AppShellClient>
      </body>
    </html>
  );
}
