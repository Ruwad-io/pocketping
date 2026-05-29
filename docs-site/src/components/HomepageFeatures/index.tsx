import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Reply from your phone',
    description: (
      <>
        Visitor messages land in Telegram, Discord, or Slack. Reply right from the
        apps you already use — no extra dashboard to keep open.
      </>
    ),
  },
  {
    title: 'Self-host in minutes',
    description: (
      <>
        Run the standalone Go bridge server with Docker, or embed PocketPing into your
        own backend with the Node, Python, Go, PHP, or Ruby SDK. Your data, your infra.
      </>
    ),
  },
  {
    title: 'No dashboard required',
    description: (
      <>
        AI fallback answers when you are away, custom events sync both directions, and
        the lightweight widget drops in with two lines of code.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
