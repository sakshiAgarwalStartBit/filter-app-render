import { Form, redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>SB Product Filter</h1>
        <p className={styles.text}>
          Let shoppers filter your collection pages and search results by
          price, availability, vendor, tags, product type, category, variant
          options, reviews, and product metafields.
        </p>
        <Form className={styles.form} method="post" action="/auth/login">
          <label className={styles.label}>
            <span>Shop domain</span>
            <input
              className={styles.input}
              type="text"
              name="shop"
              placeholder="my-shop-domain.myshopify.com"
            />
          </label>
          <button className={styles.button} type="submit">
            Install app
          </button>
        </Form>
        <ul className={styles.list}>
          <li>
            <strong>Powerful filtering</strong>. Price, availability, vendor,
            tags, product type, category, variant options, reviews, and
            metafields — all configurable from your admin.
          </li>
          <li>
            <strong>Flexible layouts</strong>. Vertical sidebar, horizontal
            bar, or slide-out drawer, with live product counts as shoppers
            filter.
          </li>
          <li>
            <strong>Wishlist</strong>. An optional wishlist widget that syncs
            for logged-in customers.
          </li>
        </ul>
      </div>
    </div>
  );
}
