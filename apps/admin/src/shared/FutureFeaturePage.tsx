import { useEffect, useState } from "react";
import { ArrowRight, CheckCheck, ChefHat, Clock3, Pause, Play, Sparkles } from "lucide-react";
import type { NavSection } from "../data/catalog";
import type { FeatureStory } from "../data/featureStories";
import { featureStory } from "../data/featureStories";
import { futureScene } from "../data/futureScenes";
import { FutureScene, sceneCaptions } from "./FutureScene";
import { Icon } from "./ui";

export function FutureFeaturePage({ section, title, slug }: {
  section: NavSection;
  title: string;
  slug: string;
}) {
  const story = featureStory(section.id, slug);
  if (section.id === "branches" && slug === "kitchen-load") {
    return <KitchenLoadPreview story={story} />;
  }
  return <UnifiedFuturePreview key={`${section.id}/${slug}`} section={section} title={title} slug={slug} story={story} />;
}

function UnifiedFuturePreview({ section, title, slug, story }: {
  section: NavSection;
  title: string;
  slug: string;
  story: FeatureStory;
}) {
  const scene = futureScene(section.id, slug);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(() => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStage((current) => (current + 1) % 3), 4200);
    return () => window.clearInterval(timer);
  }, [playing]);

  const selectStage = (index: number) => { setStage(index); setPlaying(false); };

  return <div className="kitchen-preview-page future-unified-page">
    <div className="kitchen-preview-heading">
      <div>
        <span className="kitchen-preview-path">{section.label.toLocaleUpperCase("tr-TR")} <ArrowRight size={13} aria-hidden="true" /> GELECEKTE</span>
        <h1>{title}</h1>
      </div>
      <span className="kitchen-preview-badge"><Clock3 size={17} aria-hidden="true" /> Çok yakında</span>
    </div>
    <section className="kitchen-preview-hero" aria-labelledby="future-preview-title">
      <div className="kitchen-preview-copy">
        <span className="kitchen-preview-kicker"><span><Icon name={section.icon} size={21} /></span> {sceneCaptions[scene.kind]}</span>
        <h2 id="future-preview-title">{story.headline}</h2>
        <p>{story.description}</p>
        <div className="kitchen-stage-story" aria-live="off">
          <span className="kitchen-stage-number">0{stage + 1} <small>/ 03</small></span>
          <div><span className="kitchen-stage-eyebrow">BU SAYFADA NELER OLACAK?</span><strong>{story.benefits[stage]}</strong></div>
        </div>
        <div className="kitchen-stage-controls" aria-label={`${title} faydaları`}>
          {story.benefits.map((benefit, index) => <button type="button" key={benefit} className={stage === index ? "is-active" : ""} onClick={() => selectStage(index)} aria-label={`${index + 1}. ${benefit}`} aria-pressed={stage === index}><span>0{index + 1}</span><span>{benefit}</span></button>)}
        </div>
      </div>
      <div className="kitchen-preview-art future-unified-art" data-scene={scene.kind}>
        <span className="kitchen-preview-orbit orbit-one" aria-hidden="true" />
        <span className="kitchen-preview-orbit orbit-two" aria-hidden="true" />
        <div className="kitchen-board future-unified-board" aria-label={`${title} için temsili görünüm`}>
          <div className="kitchen-board-top"><div><span className="kitchen-board-icon"><Icon name={section.icon} size={23} /></span><div><strong>{title}</strong><small>Örnek görünüm</small></div></div><span className="kitchen-board-example">TEMSİLİ ÖRNEK</span></div>
          <div className="kitchen-board-progress" aria-hidden="true">{story.benefits.map((benefit, index) => <span key={benefit} className={index <= stage ? "is-filled" : ""} />)}</div>
          <div className="future-unified-visual"><FutureScene spec={scene} stage={stage} title={title} sceneId={`${section.id}/${slug}`} /></div>
          <div className="kitchen-board-bottom"><span><span className="kitchen-board-live-dot" /> {story.benefits[stage]}</span><button type="button" className="kitchen-play-button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Örnek akışı durdur" : "Örnek akışı oynat"}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? "Durdur" : "Oynat"}</button></div>
        </div>
        <span className="kitchen-preview-art-label"><Sparkles size={15} aria-hidden="true" /> {scene.items[stage]}</span>
      </div>
    </section>
    <div className="kitchen-preview-benefits" aria-label={`${title} size nasıl yardımcı olur?`}>
      {story.benefits.map((benefit, index) => <div key={benefit}><span className="kitchen-benefit-icon">{index === 0 ? <Sparkles size={21} aria-hidden="true" /> : index === 1 ? <Clock3 size={21} aria-hidden="true" /> : <CheckCheck size={21} aria-hidden="true" />}</span><div><strong>0{index + 1}</strong><p>{benefit}</p></div></div>)}
    </div>
  </div>;
}

const kitchenStages = [
  { label: "Sırada", title: "Sipariş mutfağa düştü", detail: "Yeni iş, bekleyenlerin yanında görünür.", icon: Clock3 },
  { label: "Hazırlanıyor", title: "Ekip hazırlığa başladı", detail: "Hangi işin üzerinde çalışıldığı anlaşılır.", icon: ChefHat },
  { label: "Servise hazır", title: "Servis sırası geldi", detail: "Hazır olan tabak gözden kaçmaz.", icon: CheckCheck },
] as const;

function KitchenLoadPreview({ story }: { story: FeatureStory }) {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(() => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStage((current) => (current + 1) % kitchenStages.length), 3600);
    return () => window.clearInterval(timer);
  }, [playing]);

  const selectStage = (index: number) => { setStage(index); setPlaying(false); };
  const activeStage = kitchenStages[stage];

  return <div className="kitchen-preview-page">
    <div className="kitchen-preview-heading">
      <div>
        <span className="kitchen-preview-path">ŞUBELER VE CANLI DURUM <ArrowRight size={13} aria-hidden="true" /> GELECEKTE</span>
        <h1>Mutfak Yoğunluğu</h1>
      </div>
      <span className="kitchen-preview-badge"><Clock3 size={17} aria-hidden="true" /> Çok yakında</span>
    </div>
    <section className="kitchen-preview-hero" aria-labelledby="kitchen-preview-title">
      <div className="kitchen-preview-copy">
        <span className="kitchen-preview-kicker"><span><ChefHat size={21} aria-hidden="true" /></span> MUTFAKTA NELER OLUYOR?</span>
        <h2 id="kitchen-preview-title">Her siparişin yolunu görün.</h2>
        <p>Bir sipariş geldiğinde, hazırlanırken ve servise çıkarken ekibiniz aynı resmi görsün.</p>
        <div className="kitchen-stage-story" aria-live="off">
          <span className="kitchen-stage-number">0{stage + 1} <small>/ 03</small></span>
          <div><span className="kitchen-stage-eyebrow">ÖRNEK AKIŞ</span><strong>{activeStage.title}</strong><span>{activeStage.detail}</span></div>
        </div>
        <div className="kitchen-stage-controls" aria-label="Örnek siparişin aşamaları">
          {kitchenStages.map((item, index) => <button type="button" key={item.label} className={stage === index ? "is-active" : ""} onClick={() => selectStage(index)} aria-pressed={stage === index}><span>0{index + 1}</span>{item.label}</button>)}
        </div>
      </div>
      <div className="kitchen-preview-art">
        <span className="kitchen-preview-orbit orbit-one" aria-hidden="true" />
        <span className="kitchen-preview-orbit orbit-two" aria-hidden="true" />
        <div className="kitchen-board" aria-label="Örnek siparişin mutfaktaki yolculuğu">
          <div className="kitchen-board-top"><div><span className="kitchen-board-icon"><ChefHat size={23} aria-hidden="true" /></span><div><strong>Mutfak akışı</strong><small>Bir siparişin yolculuğu</small></div></div><span className="kitchen-board-example">TEMSİLİ ÖRNEK</span></div>
          <div className="kitchen-board-progress" aria-hidden="true">{kitchenStages.map((item, index) => <span key={item.label} className={index <= stage ? "is-filled" : ""} />)}</div>
          <div className="kitchen-board-lanes">
            {kitchenStages.map((item, index) => <div key={item.label} className={`kitchen-board-lane lane-${index} ${stage === index ? "is-current" : ""}`}>
              <h3><item.icon size={19} aria-hidden="true" /> {item.label} <span>{stage === index ? "02" : "01"}</span></h3>
              <div className="kitchen-board-ticket is-background"><small>{["Masa 04", "Sipariş 16", "Masa 07"][index]}</small><strong>{["Izgara tabağı", "Buzlu latte", "Filtre kahve"][index]}</strong></div>
              {stage === index && <div className="kitchen-board-ticket is-featured" key={stage}><span className="kitchen-ticket-symbol"><ChefHat size={22} aria-hidden="true" /></span><small>Masa 12 · Sıcak mutfak</small><strong>Sebzeli makarna</strong><span>{item.label}</span></div>}
              {stage !== index && <div className="kitchen-lane-placeholder" aria-hidden="true"><span /><span /></div>}
            </div>)}
          </div>
          <div className="kitchen-board-bottom"><span><span className="kitchen-board-live-dot" /> Siparişin yeri gözünüzün önünde</span><button type="button" className="kitchen-play-button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Örnek akışı durdur" : "Örnek akışı oynat"}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? "Durdur" : "Oynat"}</button></div>
        </div>
        <span className="kitchen-preview-art-label"><Sparkles size={15} aria-hidden="true" /> Mutfakta olan biteni tek bakışta anlayın</span>
      </div>
    </section>
    <div className="kitchen-preview-benefits" aria-label="Mutfak Yoğunluğu size nasıl yardımcı olur?">
      <div><span className="kitchen-benefit-icon"><ChefHat size={22} aria-hidden="true" /></span><div><strong>Yoğunluğu görün</strong><p>{story.benefits[0]}</p></div></div>
      <div><span className="kitchen-benefit-icon"><Clock3 size={22} aria-hidden="true" /></span><div><strong>Sırayı koruyun</strong><p>{story.benefits[1]}</p></div></div>
      <div><span className="kitchen-benefit-icon"><CheckCheck size={22} aria-hidden="true" /></span><div><strong>Servisi hızlandırın</strong><p>{story.benefits[2]}</p></div></div>
    </div>
  </div>;
}
