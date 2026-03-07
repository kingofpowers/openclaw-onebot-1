declare module "node-html-to-image" {
  export default function (options: {
    output: string;
    html: string;
    type?: string;
    quality?: number;
    puppeteerArgs?: object;
  }): Promise<string | Buffer | (string | Buffer)[]>;
}
