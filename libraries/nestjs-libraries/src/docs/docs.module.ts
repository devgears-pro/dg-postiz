import { Global, Module } from '@nestjs/common';
import { DOCS_STORAGE } from './docs.storage.interface';
import { LocalDocsStorage } from './local.docs.storage';
import { DocsService } from './docs.service';

@Global()
@Module({
  providers: [
    {
      provide: DOCS_STORAGE,
      useFactory: () => new LocalDocsStorage(),
    },
    DocsService,
  ],
  exports: [DOCS_STORAGE, DocsService],
})
export class DocsModule {}
