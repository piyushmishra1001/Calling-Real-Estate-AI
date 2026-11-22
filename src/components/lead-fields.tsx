import { input, label } from "./ui";

type Values = Partial<Record<"name" | "phone" | "email" | "source" | "enquiry_type" | "preferred_config" | "preferred_location" | "budget" | "purchase_timeline", string | number | null>>;

/** Shared inputs for the add-lead and edit-lead forms. Phone is only shown when adding. */
export function LeadFields({ values = {}, withPhone = false }: { values?: Values; withPhone?: boolean }) {
  const v = (k: keyof Values) => (values[k] == null ? "" : String(values[k]));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className={label} htmlFor="name">Name</label><input id="name" name="name" defaultValue={v("name")} required maxLength={120} className={input} /></div>
      {withPhone && <div><label className={label} htmlFor="phone">Phone</label><input id="phone" name="phone" defaultValue={v("phone")} required inputMode="tel" placeholder="98765 43210" className={input} /></div>}
      <div><label className={label} htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={v("email")} className={input} /></div>
      <div><label className={label} htmlFor="source">Source</label><input id="source" name="source" defaultValue={v("source")} placeholder="99acres, walk-in, referral" className={input} /></div>
      <div><label className={label} htmlFor="enquiry_type">Enquiry type</label>
        <select id="enquiry_type" name="enquiry_type" defaultValue={v("enquiry_type")} className={input}>
          <option value="">Not known</option><option value="residential">Residential</option><option value="commercial">Commercial</option>
        </select></div>
      <div><label className={label} htmlFor="preferred_config">Configuration</label><input id="preferred_config" name="preferred_config" defaultValue={v("preferred_config")} placeholder="3 BHK" className={input} /></div>
      <div><label className={label} htmlFor="preferred_location">Preferred location</label><input id="preferred_location" name="preferred_location" defaultValue={v("preferred_location")} className={input} /></div>
      <div><label className={label} htmlFor="budget">Budget</label><input id="budget" name="budget" defaultValue={v("budget")} placeholder="85 lakh or 1.2 cr" className={input} /></div>
      <div><label className={label} htmlFor="purchase_timeline">Buying timeline</label><input id="purchase_timeline" name="purchase_timeline" defaultValue={v("purchase_timeline")} placeholder="2 months, this month, just exploring" className={input} /></div>
    </div>
  );
}
