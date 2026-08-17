import "./globals.css";

export const metadata = {
  title: "Frah Chat",
  description: "Frah Chat - mtandao wa mawasiliano",
};

export default function RootLayout({ children }) {
  return (
    <html lang="sw">
      <body>{children}</body>
    </html>
  );
}
