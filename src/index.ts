import {Position, Range, Uri, ExtensionContext, workspace, LanguageClient, services, ServerOptions, Document, LanguageClientOptions} from 'coc.nvim';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {IMdParser} from 'vscode-markdown-languageservice';
import {glob} from 'glob'
import * as mdls from 'vscode-markdown-languageservice';
import fs from 'fs/promises';
import markdownit from 'markdown-it'

class InMemoryDocument implements mdls.ITextDocument {

  private readonly _doc: TextDocument;

  public readonly uri: string;
  public readonly $uri?: Uri;
  public readonly version: number;
  public readonly lineCount: number;

  constructor(
    uri: Uri,
    contents: string,
    version: number = 0,
  ) {
    this.uri = uri.toString();
    this.$uri = uri;
    this.version = version;
    this._doc = TextDocument.create(this.$uri.toString(), 'markdown', 0, contents);
    this.lineCount = this._doc.lineCount;
  }

  getText(range?: Range): string {
    return this._doc.getText(range);
  }

  positionAt(offset: number): Position {
    const pos = this._doc.positionAt(offset);
    return pos;
  }
  offsetAt(position: Position): number {
    return this._doc.offsetAt(position);
  }
}

class NormalDocument implements mdls.ITextDocument {

  private readonly _doc: Document;
  public readonly uri: string;
  public readonly $uri?: Uri;
  public readonly version: number;
  public readonly lineCount: number;

  constructor(
    doc: Document,
  ) {
    this._doc = doc;
    this.uri = doc.uri;
    this.$uri = Uri.parse(doc.uri);
    this.version = doc.version;
    this.lineCount = this._doc.textDocument.lineCount;
  }

  getText(range?: Range): string {
    return this._doc.textDocument.getText(range);
  }

  positionAt(offset: number): Position {
    const pos = this._doc.textDocument.positionAt(offset);
    return pos;
  }
  offsetAt(position: Position): number {
    return this._doc.textDocument.offsetAt(position);
  }
}


const mdIt = markdownit()
  .use(require('markdown-it-front-matter'), function (_: any) {})
  .use(require('markdown-it-attrs'), {})
  ;

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('coc-markdown')
  const isEnable = config.get<boolean>('enable', true)
  if (!isEnable) {
    return
  }

  const parser: IMdParser = {
    slugifier: mdls.githubSlugifier,
    async tokenize(document) {
      console.info(JSON.stringify(mdIt.parse(document.getText(), {})))
      return mdIt.parse(document.getText(), {})
    }
  };

  const serverOptions: ServerOptions = {
    command: 'vscode-markdown-languageserver',
    args: ['--stdio']
  }
  const clientOptions: LanguageClientOptions = {documentSelector: ['markdown']}
  const client = new LanguageClient(
    'vscode-markdown-languageserver', // the id
    'vscode-markdown-languageserver', // the name of the language server
    serverOptions,
    clientOptions
  )

  client.onRequest('markdown/parse', async (e: {uri: string, text?: string}) => {
    const uri = Uri.parse(e.uri);
    if (typeof e.text === 'string') {
      return parser.tokenize(new InMemoryDocument(uri, e.text, -1));
    } else {
      const text = await workspace.readFile(uri.toString());
      return parser.tokenize(new InMemoryDocument(uri, text, -1));
    }
  });
  client.onRequest('markdown/findMarkdownFilesInWorkspace', async (): Promise<string[]> => {
    return glob('**/*.md', {ignore: '**/node_modules/**', cwd: workspace.root});
  });
  client.onRequest('markdown/fs/readFile', async (e: {uri: string}): Promise<number[]> => {
    const uri = Uri.parse(e.uri);
    const res = await fs.readFile(uri.fsPath);
    return Array.from(Array.from(res));
  });
  client.onRequest('markdown/fs/stat', async (e): Promise<{isDirectory: boolean} | undefined> => {
    try {
      const uri = Uri.parse(e.uri);
      const stat = await fs.stat(uri.fsPath);
      return {isDirectory: stat.isDirectory()};
    } catch {
      return undefined;
    }
  });
  client.onRequest('markdown/fs/readDirectory', async (e): Promise<[string, {isDirectory: boolean}][]> => {
    const uri = Uri.parse(e.uri);
    const result = await fs.readdir(uri.fsPath, {withFileTypes: true});
    return result.map((direntry) => [direntry.name, {isDirectory: direntry.isDirectory()}]);
  });

  context.subscriptions.push(services.registerLanguageClient(client))
  // send settings to ls
  client.sendNotification('workspace/didChangeConfiguration', {settings: workspace.getConfiguration()})
}
