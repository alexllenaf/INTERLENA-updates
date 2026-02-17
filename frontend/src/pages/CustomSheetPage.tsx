import React from "react";
import { useParams } from "react-router-dom";
import { PageBuilderPage } from "../components/pageBuilder";
import { PAGE_CONFIG_VERSION, type PageConfig } from "../components/pageBuilder/types";
import { useI18n } from "../i18n";

type CustomSheet = {
  id: string;
  name: string;
};

type Props = {
  sheets: CustomSheet[];
};

const CustomSheetPage: React.FC<Props> = ({ sheets }) => {
  const { t } = useI18n();
  const { sheetId } = useParams<{ sheetId: string }>();
  const sheet = sheets.find((item) => item.id === sheetId);

  if (!sheetId || !sheet) {
    return <div className="empty">{t("This sheet does not exist.")}</div>;
  }

  const pageId = `sheet:${sheetId}`;
  const fallbackConfig: PageConfig = {
    id: pageId,
    version: PAGE_CONFIG_VERSION,
    blocks: []
  };

  return (
    <PageBuilderPage
      pageId={pageId}
      className="custom-sheet-builder"
      fallbackConfig={fallbackConfig}
    />
  );
};

export default CustomSheetPage;
