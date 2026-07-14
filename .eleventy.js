module.exports = function (eleventyConfig) {
  // 画像・静的ツールはそのままコピー
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/static": "." });

  // static配下のHTMLはテンプレート処理せずコピーのみ
  eleventyConfig.ignores.add("src/static/**");

  // LP訴求違いページ用: site.heroをvariantの値で上書きしたコピーを返す
  // (空でないフィールドだけ上書き。site本体は書き換えない)
  eleventyConfig.addFilter("withHero", (site, variant) => {
    const next = JSON.parse(JSON.stringify(site));
    ["eyebrow", "headline", "jp", "desc", "image"].forEach((key) => {
      if (variant[key]) next.hero[key] = variant[key];
    });
    return next;
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
