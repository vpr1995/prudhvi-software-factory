/**
 * The home page. Built once at build time.
 *
 * @returns The page.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <div className="home">
      <main id="main" className="home-main">
        <h1>National Parks Tracker</h1>
      </main>
    </div>
  );
}
