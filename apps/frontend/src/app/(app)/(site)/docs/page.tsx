import { DocsManager } from '@gitroom/frontend/components/docs/docs.manager';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Docs`,
  description: '',
};

export default async function Page() {
  return <DocsManager />;
}
