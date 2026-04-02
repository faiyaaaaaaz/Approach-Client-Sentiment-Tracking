export const metadata = {
  title: "CSAT Dashboard",
  description: "Internal tool"
};

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
